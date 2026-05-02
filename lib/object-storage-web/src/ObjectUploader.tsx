import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import Uppy from "@uppy/core";
import type { UppyFile, UploadResult } from "@uppy/core";
import DashboardModal from "@uppy/react/dashboard-modal";
import "@uppy/core/css/style.min.css";
import "@uppy/dashboard/css/style.min.css";
import AwsS3 from "@uppy/aws-s3";

interface ObjectUploaderProps {
  maxNumberOfFiles?: number;
  maxFileSize?: number;
  /**
   * Optional list of allowed MIME types / file extensions. Passed through to
   * Uppy's `restrictions.allowedFileTypes` (e.g. ["image/*"], or explicit
   * document MIME types for PDF/PPTX/DOCX/ZIP pickers).
   */
  allowedFileTypes?: readonly string[];
  /**
   * Function to get upload parameters for each file.
   * IMPORTANT: This receives the file object - use file.name, file.size, file.type
   * to request per-file presigned URLs from your backend.
   */
  onGetUploadParameters: (
    file: UppyFile<Record<string, unknown>, Record<string, unknown>>
  ) => Promise<{
    method: "PUT";
    url: string;
    headers?: Record<string, string>;
  }>;
  onComplete?: (
    result: UploadResult<Record<string, unknown>, Record<string, unknown>>
  ) => void;
  /**
   * Callback invoked when an individual file upload fails (e.g. the backend
   * rejected the presigned-URL request with a 4xx, or the PUT itself
   * failed). Receives a human-readable message extracted from the upstream
   * error so callers can surface it via a toast / notification.
   */
  onUploadError?: (message: string) => void;
  buttonClassName?: string;
  children: ReactNode;
}

/**
 * A file upload component that renders as a button and provides a modal interface for
 * file management.
 *
 * Features:
 * - Renders as a customizable button that opens a file upload modal
 * - Provides a modal interface for:
 *   - File selection
 *   - File preview
 *   - Upload progress tracking
 *   - Upload status display
 *
 * The component uses Uppy v5 under the hood to handle all file upload functionality.
 * All file management features are automatically handled by the Uppy dashboard modal.
 *
 * @param props - Component props
 * @param props.maxNumberOfFiles - Maximum number of files allowed to be uploaded
 *   (default: 1)
 * @param props.maxFileSize - Maximum file size in bytes (default: 10MB)
 * @param props.onGetUploadParameters - Function to get upload parameters for each file.
 *   Receives the UppyFile object with file.name, file.size, file.type properties.
 *   Use these to request per-file presigned URLs from your backend. Returns method,
 *   url, and optional headers for the upload request.
 * @param props.onComplete - Callback function called when upload is complete. Typically
 *   used to make post-upload API calls to update server state and set object ACL
 *   policies.
 * @param props.buttonClassName - Optional CSS class name for the button
 * @param props.children - Content to be rendered inside the button
 */
export function ObjectUploader({
  maxNumberOfFiles = 1,
  maxFileSize = 10485760, // 10MB default
  allowedFileTypes,
  onGetUploadParameters,
  onComplete,
  onUploadError,
  buttonClassName,
  children,
}: ObjectUploaderProps) {
  const onCompleteRef = useRef(onComplete);
  const onGetUploadParametersRef = useRef(onGetUploadParameters);
  const onUploadErrorRef = useRef(onUploadError);
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);
  useEffect(() => { onGetUploadParametersRef.current = onGetUploadParameters; }, [onGetUploadParameters]);
  useEffect(() => { onUploadErrorRef.current = onUploadError; }, [onUploadError]);

  const [showModal, setShowModal] = useState(false);
  const [uppy] = useState(() =>
    new Uppy({
      restrictions: {
        maxNumberOfFiles,
        maxFileSize,
        ...(allowedFileTypes && allowedFileTypes.length > 0
          ? { allowedFileTypes: [...allowedFileTypes] }
          : {}),
      },
      autoProceed: false,
    })
      .use(AwsS3, {
        shouldUseMultipart: false,
        getUploadParameters: (file) => onGetUploadParametersRef.current(file),
      })
      .on("complete", (result) => {
        onCompleteRef.current?.(result);
      })
      .on("upload-error", (_file, error, response) => {
        // The api-server returns `{ error: "..." }` JSON on 4xx; surface
        // that message verbatim when present so editors see exactly why
        // their video was rejected (e.g. "Unsupported video format
        // 'video/x-matroska'..."). Falls back to Uppy's own message.
        const body = (response as { body?: unknown } | undefined)?.body;
        const apiMessage =
          body && typeof body === "object" && "error" in body
            ? String((body as { error?: unknown }).error ?? "")
            : "";
        const fallback = error instanceof Error ? error.message : String(error);
        onUploadErrorRef.current?.(apiMessage || fallback || "Upload failed");
      })
      .on("restriction-failed", (_file, error) => {
        // Triggered when Uppy's own pre-upload restrictions reject a file
        // (allowedFileTypes mismatch, maxFileSize exceeded, etc.). Without
        // this hook the error only appears inside the dashboard modal.
        const message =
          error instanceof Error ? error.message : String(error);
        onUploadErrorRef.current?.(message || "File rejected");
      })
  );

  // Keep Uppy's restrictions in sync with prop changes so that switching the
  // asset kind filter in AssetLibraryModal correctly updates file type and
  // size caps without needing to recreate the Uppy instance.
  useEffect(() => {
    uppy.setOptions({
      restrictions: {
        maxNumberOfFiles,
        maxFileSize,
        ...(allowedFileTypes && allowedFileTypes.length > 0
          ? { allowedFileTypes: [...allowedFileTypes] }
          : { allowedFileTypes: undefined }),
      },
    });
  }, [uppy, maxNumberOfFiles, maxFileSize, allowedFileTypes]);

  return (
    <div>
      <button onClick={() => setShowModal(true)} className={buttonClassName}>
        {children}
      </button>

      <DashboardModal
        uppy={uppy}
        open={showModal}
        onRequestClose={() => setShowModal(false)}
        proudlyDisplayPoweredByUppy={false}
      />
    </div>
  );
}
