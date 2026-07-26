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

/**
 * Boundary for the future audited myPOS Checkout integration. Its implementation must own
 * RSA signing/verification, replay protection and exact sandbox wire formats.
 */
export interface MyPosCheckoutGateway {
	createCheckout(request: CheckoutRequest): Promise<CheckoutSession>;
	verifyCallback(payload: CallbackPayload): Promise<VerifiedPaymentEvent>;
	getPaymentStatus(externalPaymentId: string): Promise<PaymentStatus>;
	refund(request: RefundRequest): Promise<RefundResult>;
}

export interface MyPosAdapterOptions {
	enabled?: boolean;
	gateway?: MyPosCheckoutGateway;
}

/** Disabled by default. Inject a sandbox-tested gateway explicitly before enabling it. */
export class MyPosPaymentAdapter implements PaymentAdapter {
	readonly provider = 'mypos' as const;
	readonly enabled: boolean;
	private readonly gateway?: MyPosCheckoutGateway;

	constructor(options: MyPosAdapterOptions = {}) {
		this.enabled = options.enabled === true;
		this.gateway = options.gateway;
	}

	private requireGateway(): MyPosCheckoutGateway {
		if (!this.enabled) throw new PaymentsDisabledError('myPOS payments are disabled.');
		if (!this.gateway) {
			throw new PaymentConfigurationError(
				'myPOS is enabled without an audited MyPosCheckoutGateway implementation.'
			);
		}
		return this.gateway;
	}

	createCheckout(request: CheckoutRequest): Promise<CheckoutSession> {
		return this.requireGateway().createCheckout(request);
	}

	verifyCallback(payload: CallbackPayload): Promise<VerifiedPaymentEvent> {
		return this.requireGateway().verifyCallback(payload);
	}

	getPaymentStatus(externalPaymentId: string): Promise<PaymentStatus> {
		return this.requireGateway().getPaymentStatus(externalPaymentId);
	}

	refund(request: RefundRequest): Promise<RefundResult> {
		return this.requireGateway().refund(request);
	}
}
