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
import { PaymentsDisabledError } from './types';

export class DisabledPaymentAdapter implements PaymentAdapter {
	readonly provider = 'disabled' as const;
	readonly enabled = false;

	private unavailable(): never {
		throw new PaymentsDisabledError();
	}

	async createCheckout(_request: CheckoutRequest): Promise<CheckoutSession> {
		return this.unavailable();
	}

	async verifyCallback(_payload: CallbackPayload): Promise<VerifiedPaymentEvent> {
		return this.unavailable();
	}

	async getPaymentStatus(_externalPaymentId: string): Promise<PaymentStatus> {
		return this.unavailable();
	}

	async refund(_request: RefundRequest): Promise<RefundResult> {
		return this.unavailable();
	}
}
