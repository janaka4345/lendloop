export interface EcsExpressPrimaryContainer {
  image: string;
  containerPort?: number;
  command?: string[];
  environment?: Array<{ name: string; value: string }>;
  secrets?: Array<{ name: string; valueFrom: string }>;
  awsLogsConfiguration?: {
    logGroup?: string;
    logStreamPrefix?: string;
  };
  repositoryCredentials?: {
    credentialsParameter?: string;
  };
}

export interface EcsExpressServiceConfiguration {
  createdAt?: number;
  serviceRevisionArn?: string;
  executionRoleArn?: string;
  healthCheckPath?: string;
  cpu?: string;
  memory?: string;
  ingressPaths?: Array<{
    accessType?: string;
    endpoint?: string;
  }>;
  primaryContainer?: EcsExpressPrimaryContainer;
}

export interface EcsExpressServiceDescription {
  serviceArn?: string;
  serviceName?: string;
  cluster?: string;
  currentDeployment?: string;
  status?: {
    statusCode?: string;
    statusReason?: string;
  };
  activeConfigurations?: EcsExpressServiceConfiguration[];
}

export function validateDigestImageUri(imageUri: string): void;

export function getActiveConfiguration(
  service: EcsExpressServiceDescription,
): EcsExpressServiceConfiguration;

export function buildSafeUpdatePrimaryContainer(
  existingService: EcsExpressServiceDescription,
  imageUri: string,
): EcsExpressPrimaryContainer;

export function assertDeployedImageDigest(
  service: EcsExpressServiceDescription,
  expectedImageUri: string,
): void;

export function resolveExpressServiceUrl(service: EcsExpressServiceDescription): string;

export function verifyServiceHealth(options: {
  baseUrl: string;
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  maxAttempts?: number;
  delayMs?: number;
}): Promise<void>;

export function deployEcsExpressService(options: {
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
