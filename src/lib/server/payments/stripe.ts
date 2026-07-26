import type {
	CallbackPayload,
	CheckoutRequest,
	CheckoutSession,
	PaymentAdapter,
	PaymentStatus,
	RefundRequest,
	RefundResult,
	VerifiedPaymentEvent
} from './types';
import { PaymentConfigurationError, PaymentsDisabledError } from './types';

/** Stripe SDK/API details stay behind this port so the domain and routes never import an SDK. */
export interface StripeGateway {
	createCheckout(request: CheckoutRequest): Promise<CheckoutSession>;
	verifyWebhook(payload: CallbackPayload): Promise<VerifiedPaymentEvent>;
	getPaymentStatus(externalPaymentId: string): Promise<PaymentStatus>;
	refund(request: RefundRequest): Promise<RefundResult>;
}

export class StripePaymentAdapter implements PaymentAdapter {
	readonly provider = 'stripe' as const;
	readonly enabled: boolean;

	constructor(
		private readonly gateway?: StripeGateway,
		enabled = false
	) {
		this.enabled = enabled;
	}

	private requireGateway(): StripeGateway {
		if (!this.enabled) throw new PaymentsDisabledError('Stripe fallback is disabled.');
		if (!this.gateway) {
			throw new PaymentConfigurationError('Stripe is enabled without a StripeGateway implementation.');
		}
		return this.gateway;
	}

	createCheckout(request: CheckoutRequest): Promise<CheckoutSession> {
		return this.requireGateway().createCheckout(request);
	}

	verifyCallback(payload: CallbackPayload): Promise<VerifiedPaymentEvent> {
		return this.requireGateway().verifyWebhook(payload);
	}

	getPaymentStatus(externalPaymentId: string): Promise<PaymentStatus> {
		return this.requireGateway().getPaymentStatus(externalPaymentId);
	}

	refund(request: RefundRequest): Promise<RefundResult> {
		return this.requireGateway().refund(request);
	}
}
