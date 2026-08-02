import type { FeatureFlags, FeatureFlagName } from '../feature-flags';
import type {
	CallbackPayload,
	CheckoutRequest,
	CheckoutSession,
	PaymentAdapter,
	PaymentPurpose,
	PaymentStatus,
	RefundRequest,
	RefundResult,
	VerifiedPaymentEvent
} from './types';
import { PaymentsDisabledError } from './types';

const PURPOSE_FLAGS: Readonly<Record<PaymentPurpose, FeatureFlagName>> = {
	extra_listing: 'listingFees',
	merchant_start: 'merchantSubscriptions',
	merchant_pro: 'merchantSubscriptions',
	boost: 'boosts'
};

export class PurposeGatedPaymentAdapter implements PaymentAdapter {
	constructor(
		private readonly adapter: PaymentAdapter,
		private readonly flags: FeatureFlags
	) {}

	get provider() {
		return this.adapter.provider;
	}

	get enabled() {
		return this.adapter.enabled;
	}

	createCheckout(request: CheckoutRequest): Promise<CheckoutSession> {
		const purposeFlag = PURPOSE_FLAGS[request.purpose];
		if (!this.flags.billing || !this.flags[purposeFlag]) {
			throw new PaymentsDisabledError(`Payment purpose is disabled: ${request.purpose}.`);
		}
		return this.adapter.createCheckout(request);
	}

	verifyCallback(payload: CallbackPayload): Promise<VerifiedPaymentEvent> {
		return this.adapter.verifyCallback(payload);
	}

	getPaymentStatus(externalPaymentId: string): Promise<PaymentStatus> {
		return this.adapter.getPaymentStatus(externalPaymentId);
	}

	refund(request: RefundRequest): Promise<RefundResult> {
		return this.adapter.refund(request);
	}
}
