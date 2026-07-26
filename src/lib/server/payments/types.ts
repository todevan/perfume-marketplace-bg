export type PaymentProvider = 'disabled' | 'mypos' | 'stripe';
export type PaymentPurpose = 'extra_listing' | 'merchant_start' | 'merchant_pro' | 'boost';
export type PaymentState =
	| 'created'
	| 'pending'
	| 'paid'
	| 'failed'
	| 'cancelled'
	| 'refunded'
	| 'partially_refunded';

export interface CheckoutRequest {
	paymentId: string;
	profileId: string;
	purpose: PaymentPurpose;
	amountMinor: number;
	currency: 'EUR';
	successUrl: string;
	cancelUrl: string;
	idempotencyKey: string;
	metadata?: Readonly<Record<string, string>>;
}

export interface CheckoutSession {
	provider: Exclude<PaymentProvider, 'disabled'>;
	externalPaymentId: string;
	checkoutUrl: string;
	state: PaymentState;
	expiresAt?: string;
}

export interface CallbackPayload {
	headers: Readonly<Record<string, string | undefined>>;
	rawBody: string | Uint8Array;
}

export interface VerifiedPaymentEvent {
	provider: Exclude<PaymentProvider, 'disabled'>;
	eventId: string;
	externalPaymentId: string;
	state: PaymentState;
	amountMinor?: number;
	currency?: 'EUR';
	idempotencyKey?: string;
	occurredAt: string;
	rawReference?: string;
}

export interface PaymentStatus {
	provider: Exclude<PaymentProvider, 'disabled'>;
	externalPaymentId: string;
	state: PaymentState;
	amountMinor: number;
	currency: 'EUR';
}

export interface RefundRequest {
	externalPaymentId: string;
	amountMinor?: number;
	reason?: string;
	idempotencyKey: string;
}

export interface RefundResult {
	provider: Exclude<PaymentProvider, 'disabled'>;
	externalRefundId: string;
	externalPaymentId: string;
	state: 'pending' | 'succeeded' | 'failed';
	amountMinor: number;
}

export interface PaymentAdapter {
	readonly provider: PaymentProvider;
	readonly enabled: boolean;
	createCheckout(request: CheckoutRequest): Promise<CheckoutSession>;
	verifyCallback(payload: CallbackPayload): Promise<VerifiedPaymentEvent>;
	getPaymentStatus(externalPaymentId: string): Promise<PaymentStatus>;
	refund(request: RefundRequest): Promise<RefundResult>;
}

export class PaymentsDisabledError extends Error {
	readonly code = 'payments_disabled';

	constructor(message = 'Payments are disabled for the closed beta.') {
		super(message);
		this.name = 'PaymentsDisabledError';
	}
}

export class PaymentConfigurationError extends Error {
	readonly code = 'payment_configuration_error';

	constructor(message: string) {
		super(message);
		this.name = 'PaymentConfigurationError';
	}
}
