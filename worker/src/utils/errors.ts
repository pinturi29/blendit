/**
 * Centralized, typed error classes for the whole pipeline.
 *
 * Why this exists: every stage of the pipeline (usage, URL parsing, Apify,
 * downloading, frame sampling, Claude) can fail in different ways. Giving each failure its
 * own class lets src/index.ts catch everything with one `catch` block while
 * still printing a clear, specific, user-facing message -- without ever
 * leaking secrets or full API responses into that message.
 */

/** Base class for every error this program intentionally throws. */
export class AppError extends Error {
  /** Machine-readable identifier, handy for tests or future log filtering. */
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    // Keeps stack traces pointing at the real throw site instead of here.
    Error.captureStackTrace?.(this, new.target);
  }
}

export class InvalidUsageError extends AppError {
  constructor(message: string) {
    super("INVALID_USAGE", message);
  }
}

export class InvalidUrlError extends AppError {
  constructor(message: string) {
    super("INVALID_URL", message);
  }
}

export class UnsupportedPlatformError extends AppError {
  constructor(message: string) {
    super("UNSUPPORTED_PLATFORM", message);
  }
}

export class EnvironmentValidationError extends AppError {
  constructor(message: string) {
    super("INVALID_ENVIRONMENT", message);
  }
}

export class ApifyActorFailureError extends AppError {
  constructor(message: string) {
    super("APIFY_ACTOR_FAILURE", message);
  }
}

export class EmptyApifyOutputError extends AppError {
  constructor(message: string) {
    super("APIFY_EMPTY_OUTPUT", message);
  }
}

export class VideoUrlNotFoundError extends AppError {
  constructor(message: string) {
    super("VIDEO_URL_NOT_FOUND", message);
  }
}

export class DownloadError extends AppError {
  constructor(message: string) {
    super("DOWNLOAD_FAILED", message);
  }
}

export class FileTooLargeError extends AppError {
  constructor(message: string) {
    super("FILE_TOO_LARGE", message);
  }
}

export class FrameExtractionError extends AppError {
  constructor(message: string) {
    super("FRAME_EXTRACTION_FAILED", message);
  }
}

export class ClaudeAnalysisError extends AppError {
  constructor(message: string) {
    super("CLAUDE_ANALYSIS_FAILED", message);
  }
}

export class SupabaseConfigError extends AppError {
  constructor(message: string) {
    super("SUPABASE_CONFIG_MISSING", message);
  }
}

/** Type guard so index.ts can decide whether an error is "ours" or unexpected. */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
