// x402 PaymentRequired types — decoded from the PAYMENT-REQUIRED header
// Based on Coinbase's x402 protocol spec: https://github.com/coinbase/x402

/** Single payment option within the `accepts` array (x402 v1 spec) */
export interface AcceptsEntry {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  resource: string;
  description?: string;
  mimeType?: string;
  payTo: string;
  maxTimeoutSeconds?: number;
  [key: string]: unknown;
}

/** v2 resource metadata, separate from the payment requirements. */
export interface ResourceInfo {
  url: string;
  description?: string;
  mimeType?: string;
}

export interface AcceptsEntryV2 {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Decoded v1/v2 challenge, or a legacy flat/discovery document. */
export interface PaymentRequired {
  /** Supported x402 wire versions: 1 (legacy), 2 */
  x402Version?: number;
  /** Payment options the server accepts */
  accepts?: (AcceptsEntry | AcceptsEntryV2)[];
  /** Facilitator service URL for payment processing */
  facilitatorUrl?: string;

  // --- Legacy / flat-structure fields (still seen in the wild) ---
  scheme?: string;
  network?: string;
  maxAmountRequired?: string;
  resource?: string | ResourceInfo;
  description?: string;
  mimeType?: string;
  outputSchema?: unknown;
  estimatedProcessingTime?: number;
  extra?: Record<string, unknown>;
  payTo?: PayTo[] | string;
  requiredDeadlineSeconds?: number;

  [key: string]: unknown;
}

export interface PayTo {
  address: string;
  amount: string;
  token?: string;
  chain?: string | number;
  network?: string;
}

/** Result of schema validation */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/** Result of facilitator reachability check */
export interface FacilitatorResult {
  url: string;
  reachable: boolean;
  status?: number;
  error?: string;
}

export interface X402Result {
  url: string;
  supported: boolean;
  status: number;
  paymentDetails?: PaymentRequired;
  rawHeader?: string;
  headers?: Record<string, string>;
  error?: string;
  /** Schema validation result (when verbose or validation was run) */
  schemaValidation?: ValidationResult;
  /** Facilitator reachability result */
  facilitatorCheck?: FacilitatorResult;
}

export interface CheckOptions {
  timeout?: number;
  verbose?: boolean;
  /** Check facilitator reachability (default: true when verbose) */
  checkFacilitator?: boolean;
}
