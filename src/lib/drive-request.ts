/** Errors carry recovery instructions, never access tokens or upload URLs. */
export class DriveRequestError extends Error {
  constructor(message: string, readonly retryable = false, readonly needsReconnect = false) {
    super(message);
    this.name = "DriveRequestError";
  }
}

export async function driveRequest(url: string, init: RequestInit, operation: string): Promise<Response> {
  const signal = init.signal;
  try {
    return await fetch(url, { ...init, signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000) });
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof TypeError || (error instanceof DOMException && ["TimeoutError", "NetworkError", "AbortError"].includes(error.name))) {
      throw new DriveRequestError(`${operation}: the connection to Drive was interrupted. Retry backup to resume.`, true);
    }
    throw error;
  }
}

export async function driveResponseError(response: Response, operation: string): Promise<DriveRequestError> {
  if (response.status === 401) return new DriveRequestError("Reconnect Drive to continue the backup.", false, true);
  const detail = await response.json().catch(() => null) as { error?: { errors?: { reason?: string }[] } } | null;
  const reasons = detail?.error?.errors?.map(error => error.reason) ?? [];
  const retryable = response.status === 408 || response.status === 429 || response.status >= 500 ||
    (response.status === 403 && reasons.some(reason => ["rateLimitExceeded", "userRateLimitExceeded", "backendError"].includes(reason ?? "")));
  const message = reasons.includes("storageQuotaExceeded")
    ? "Google Drive storage is full. Free some space, then retry backup."
    : retryable ? `${operation}: Drive is temporarily unavailable (${response.status}). Retry backup to resume.`
      : `${operation}: Drive refused the request (${response.status}). Reconnect Drive and retry.`;
  return new DriveRequestError(message, retryable, response.status === 403 && !retryable && !reasons.includes("storageQuotaExceeded"));
}
