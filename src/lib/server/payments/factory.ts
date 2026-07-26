import type { FeatureFlags } from '../feature-flags';
import { DisabledPaymentAdapter } from './disabled';
import { MyPosPaymentAdapter, type MyPosCheckoutGateway } from './mypos';
import { StripePaymentAdapter, type StripeGateway } from './stripe';
import type { PaymentAdapter, PaymentProvider } from './types';

export interface PaymentAdapterDependencies {
	mypos?: MyPosCheckoutGateway;
	stripe?: StripeGateway;
}

export function createPaymentAdapter(
	provider: PaymentProvider | undefined,
	flags: FeatureFlags,
	dependencies: PaymentAdapterDependencies = {}
): PaymentAdapter {
	if (!flags.billing || !provider || provider === 'disabled') return new DisabledPaymentAdapter();
	if (provider === 'mypos') {
		return new MyPosPaymentAdapter({
			enabled: flags.myposPayments,
			gateway: dependencies.mypos
		});
	}
	return new StripePaymentAdapter(dependencies.stripe, flags.stripeFallback);
}
