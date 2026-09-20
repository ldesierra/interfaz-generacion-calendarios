import {
  REQUIRED_FILES,
  type CaseCreated,
  type JobResultResponse,
  type JobStatusResponse,
  type RequiredFileName,
  type SchemaValidationError,
  type SolveAccepted,
  type SolveParams,
} from "./types";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export class SchemaValidationApiError extends ApiError {
  details: SchemaValidationError["details"];

  constructor(details: SchemaValidationError["details"]) {
    super("El caso tiene errores de esquema.", 422);
    this.name = "SchemaValidationApiError";
    this.details = details;
  }
}

async function parseJsonError(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (typeof body?.detail === "string") {
      return body.detail;
    }
    return JSON.stringify(body);
  } catch {
    return response.statusText;
  }
}

export async function createCase(files: Record<RequiredFileName, File>): Promise<CaseCreated> {
  const formData = new FormData();
  for (const name of REQUIRED_FILES) {
    formData.append(name, files[name]);
  }

  const response = await fetch("/api/cases", { method: "POST", body: formData });

  if (response.status === 201) {
    return response.json();
  }
  if (response.status === 422) {
    const body: SchemaValidationError = await response.json();
    throw new SchemaValidationApiError(body.details);
  }
  throw new ApiError(await parseJsonError(response), response.status);
}

export async function solveCase(caseId: string, params: SolveParams): Promise<SolveAccepted> {
  const response = await fetch(`/api/cases/${caseId}/solve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  if (response.status === 202) {
    return response.json();
  }
  throw new ApiError(await parseJsonError(response), response.status);
}

export async function getJobStatus(jobId: string): Promise<JobStatusResponse> {
  const response = await fetch(`/api/jobs/${jobId}`);
  if (!response.ok) {
    throw new ApiError(await parseJsonError(response), response.status);
  }
  return response.json();
}

export async function getJobResult(jobId: string): Promise<JobResultResponse> {
  const response = await fetch(`/api/jobs/${jobId}/result`);
  if (!response.ok) {
    throw new ApiError(await parseJsonError(response), response.status);
  }
  return response.json();
}

export function jobDownloadUrl(jobId: string): string {
  return `/api/jobs/${jobId}/download`;
}
