export interface AppRunnerSourceConfiguration {
  AutoDeploymentsEnabled?: boolean;
  AuthenticationConfiguration?: {
    AccessRoleArn?: string;
    ConnectionArn?: string;
  };
  ImageRepository?: {
    ImageIdentifier: string;
    ImageRepositoryType: string;
    ImageConfiguration?: {
      Port?: string;
      StartCommand?: string;
      RuntimeEnvironmentVariables?: Record<string, string>;
      RuntimeEnvironmentSecrets?: Record<string, string>;
    };
  };
}

export interface AppRunnerServiceDescription {
  ServiceArn?: string;
  ServiceUrl?: string;
  Status?: string;
  SourceConfiguration?: AppRunnerSourceConfiguration;
}

export function validateDigestImageUri(imageUri: string): void;

export function buildSafeUpdateSourceConfiguration(
  existingService: AppRunnerServiceDescription,
  imageUri: string,
): Required<Pick<AppRunnerSourceConfiguration, "ImageRepository">> & AppRunnerSourceConfiguration;

export function assertDeployedImageDigest(
  service: AppRunnerServiceDescription,
  expectedImageUri: string,
): void;

export function verifyServiceHealth(options: {
  baseUrl: string;
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  maxAttempts?: number;
  delayMs?: number;
}): Promise<void>;

export function deployAppRunnerService(options: {
  serviceArn: string;
  imageUri: string;
  region?: string;
  healthBaseUrl?: string;
}): Promise<{
  serviceArn: string;
  serviceUrl: string;
  imageUri: string;
  status: string;
}>;
