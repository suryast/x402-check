// x402 PaymentRequired types — decoded from the PAYMENT-REQUIRED header
// Based on Coinbase's x402 protocol spec: https://github.com/coinbase/x402

/** Single payment option within the `accepts` array (x402 v2 spec) */
export interface AcceptsEntry {
  scheme: string;
  network: string;
  /** v2 field: amount in atomic units (wei) as a string */
  amount?: string;
  /** v1 field (deprecated in v2): max amount in atomic units */
  maxAmountRequired?: string;
  /** v1 field: resource URL (deprecated in v2 — use top-level resource block) */
  resource?: string;
  description?: string;
  mimeType?: string;
  payTo: string;
  maxTimeoutSeconds?: number;
  extra?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Full x402 PaymentRequired payload (spec-compliant v2 structure) */
export interface PaymentRequired {
  /** x402 spec version (should be 2 for v2, 1 for v1) */
  x402Version?: number;
  /** Human-readable error message */
  error?: string;
  /** Resource being paid for */
  resource?: {
    url: string;
    description: string;
    mimeType: string;
    serviceName?: string;
    tags?: string[];
    iconUrl?: string;
  };
  /** Payment options the server accepts */
  accepts?: AcceptsEntry[];
  /** Facilitator service URL for payment processing */
  facilitatorUrl?: string;
  /** Protocol extensions (bazaar, agentkit, builder-code, etc.) */
  extensions?: Record<string, unknown>;

  // --- Legacy / flat-structure fields (still seen in the wild) ---
  scheme?: string;
  network?: string;
  maxAmountRequired?: string;
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
