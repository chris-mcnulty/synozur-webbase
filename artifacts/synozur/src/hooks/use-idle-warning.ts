import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/context/auth";

// Must stay in sync with the server's IDLE_TIMEOUT_MS default (sessions.ts).
// See follow-up task #129: expose this via /api/auth/config so the value
// stays accurate if the server's env var changes.
const IDLE_TIMEOUT_MS = 4 * 60 * 60 * 1000; // 4 hours (server default)
// How far before the timeout to show the warning banner.
const WARNING_BEFORE_MS = 5 * 60 * 1000; // 5 minutes
// Match ROLLING_RENEW_MS on the server: heartbeat at most once per 30 min
// so that client activity keeps server lastSeenAt current, preventing the
// server from expiring a session while the user is visibly active.
const HEARTBEAT_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

const ACTIVITY_EVENTS = [
  "mousemove",
  "mousedown",
  "keydown",
  "touchstart",
  "scroll",
] as const;

export interface IdleWarningState {
  showWarning: boolean;
  secondsLeft: number;
  staySignedIn: () => Promise<void>;
  dismiss: () => void;
}

export function useIdleWarning(): IdleWarningState {
  const { isSignedIn, signOut } = useAuth();
  const [showWarning, setShowWarning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(
    Math.floor(WARNING_BEFORE_MS / 1000),
  );

  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // When the warning is showing, the absolute timestamp at which the session
  // will expire (so dismiss can schedule sign-out for the exact remaining ms).
  const warningExpiresAtRef = useRef<number | null>(null);
  // Ref mirror of showWarning so activity handlers don't read stale state.
  const showWarningRef = useRef(false);
  // Ref mirror of signOut so async callbacks always invoke the latest version.
  const signOutRef = useRef(signOut);
  signOutRef.current = signOut;
  // Track when we last sent a heartbeat to the server.
  const lastHeartbeatAtRef = useRef<number>(Date.now());

  const clearTimers = useCallback(() => {
    if (idleTimerRef.current !== null) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    if (countdownRef.current !== null) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  }, []);

  // Send a lightweight ping to the server so it bumps lastSeenAt, keeping
  // the server idle-clock in sync with client-side user activity.
  const sendHeartbeat = useCallback(async () => {
    try {
      const res = await fetch(`${BASE_PATH}/api/auth/session`, {
        credentials: "include",
      });
      if (res.ok) {
        const json = (await res.json()) as { signedIn: boolean };
        if (!json.signedIn) {
          // Server already expired the session — sign out cleanly.
          void signOutRef.current();
        }
      }
    } catch {
      // Ignore transient network errors; the idle timer will catch expiry.
    }
  }, []);

  const startCountdown = useCallback(() => {
    showWarningRef.current = true;
    setShowWarning(true);
    setSecondsLeft(Math.floor(WARNING_BEFORE_MS / 1000));

    const expiresAt = Date.now() + WARNING_BEFORE_MS;
    warningExpiresAtRef.current = expiresAt;

    countdownRef.current = setInterval(() => {
      const remaining = Math.max(
        0,
        Math.floor((expiresAt - Date.now()) / 1000),
      );
      setSecondsLeft(remaining);
      if (remaining <= 0) {
        if (countdownRef.current !== null) {
          clearInterval(countdownRef.current);
          countdownRef.current = null;
        }
        warningExpiresAtRef.current = null;
        void signOutRef.current();
      }
    }, 1000);
  }, []);

  const scheduleIdleTimer = useCallback(() => {
    if (idleTimerRef.current !== null) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    idleTimerRef.current = setTimeout(() => {
      idleTimerRef.current = null;
      startCountdown();
    }, IDLE_TIMEOUT_MS - WARNING_BEFORE_MS);
  }, [startCountdown]);

  // Called when the user clicks "Stay signed in".
  const staySignedIn = useCallback(async () => {
    clearTimers();
    showWarningRef.current = false;
    setShowWarning(false);
    setSecondsLeft(Math.floor(WARNING_BEFORE_MS / 1000));
    warningExpiresAtRef.current = null;

    // Ping the server to bump lastSeenAt; require a confirmed live session
    // before re-arming the idle timer. If already expired, sign out cleanly.
    try {
      const res = await fetch(`${BASE_PATH}/api/auth/session`, {
        credentials: "include",
      });
      if (res.ok) {
        const json = (await res.json()) as { signedIn: boolean };
        if (json.signedIn) {
          lastHeartbeatAtRef.current = Date.now();
          scheduleIdleTimer();
          return;
        }
      }
    } catch {
      // Fall through to sign-out on network failure.
    }
    // Session expired or server error — sign out cleanly.
    void signOutRef.current();
  }, [clearTimers, scheduleIdleTimer]);

  // Called when the user closes the dialog without acting.
  // Schedules sign-out for the exact remaining server expiry window so the
  // user doesn't get a jarring 401 on their next action.
  const dismiss = useCallback(() => {
    clearTimers();
    showWarningRef.current = false;
    setShowWarning(false);

    const remaining =
      warningExpiresAtRef.current !== null
        ? Math.max(0, warningExpiresAtRef.current - Date.now())
        : 0;
    warningExpiresAtRef.current = null;

    if (remaining <= 0) {
      void signOutRef.current();
      return;
    }

    idleTimerRef.current = setTimeout(() => {
      idleTimerRef.current = null;
      void signOutRef.current();
    }, remaining);
  }, [clearTimers]);

  useEffect(() => {
    if (!isSignedIn) {
      clearTimers();
      showWarningRef.current = false;
      setShowWarning(false);
      warningExpiresAtRef.current = null;
      return;
    }

    scheduleIdleTimer();

    const handleActivity = () => {
      if (showWarningRef.current) {
        // Warning is visible — user must use a button; don't reset timers.
        return;
      }
      // Reset the local idle countdown.
      scheduleIdleTimer();

      // Throttle server heartbeats to HEARTBEAT_INTERVAL_MS so that active
      // users keep their server session alive without hammering the API.
      const now = Date.now();
      if (now - lastHeartbeatAtRef.current >= HEARTBEAT_INTERVAL_MS) {
        lastHeartbeatAtRef.current = now;
        void sendHeartbeat();
      }
    };

    ACTIVITY_EVENTS.forEach((ev) =>
      window.addEventListener(ev, handleActivity, { passive: true }),
    );

    return () => {
      clearTimers();
      ACTIVITY_EVENTS.forEach((ev) =>
        window.removeEventListener(ev, handleActivity),
      );
    };
  }, [isSignedIn, scheduleIdleTimer, sendHeartbeat, clearTimers]);

  return { showWarning, secondsLeft, staySignedIn, dismiss };
}
