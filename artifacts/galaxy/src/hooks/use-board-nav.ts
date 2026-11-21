import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/auth";

/** Only the public flag is fetched here; private roster data never enters Galaxy. */
export function useBoardNav() {
  const { user } = useAuth();
  const { data, isError } = useQuery({
    queryKey: ["board-nav-status", user?.id ?? "anon"],
    queryFn: async () => {
      const res = await fetch("/api/board/status", { cache: "no-store" });
      if (!res.ok) throw new Error("Unable to check Board visibility");
      return res.json() as Promise<{ public: boolean }>;
    },
    staleTime: 0,
    gcTime: 0,
    refetchInterval: 30_000,
  });
  return (!isError && data?.public === true) || user?.roles.some(r => r === "admin" || r === "site_admin") === true;
}
