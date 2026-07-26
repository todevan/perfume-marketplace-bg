import { createHmac, timingSafeEqual } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
	DEFAULT_FEATURE_FLAGS,
	isPaidFeatureEnabled,
	parseBooleanFlag,
	resolveFeatureFlags,
	type FeatureFlags
} from '../../src/lib/server/feature-flags';
import { createPaymentAdapter } from '../../src/lib/server/payments/factory';
import type { MyPosCheckoutGateway } from '../../src/lib/server/payments/mypos';
import type {
	CallbackPayload,
	CheckoutRequest,
	CheckoutSession,
	PaymentStatus,
	RefundRequest,
	RefundResult,
	VerifiedPaymentEvent
} from '../../src/lib/server/payments/types';
import {
	PaymentConfigurationError,
	PaymentsDisabledError
} from '../../src/lib/server/payments/types';

const checkoutRequest: CheckoutRequest = {
	paymentId: 'payment-1',
	profileId: 'profile-1',
	purpose: 'extra_listing',
	amountMinor: 199,
	currency: 'EUR',
	successUrl: 'https://marketplace.example/payments/success',
	cancelUrl: 'https://marketplace.example/payments/cancel',
	idempotencyKey: 'checkout:payment-1:v1'
};

function flags(overrides: Partial<FeatureFlags> = {}): FeatureFlags {
	return { ...DEFAULT_FEATURE_FLAGS, ...overrides };
}

/**
 * Deterministic signed callback fake for exercising the adapter contract only.
 * It deliberately does not claim compatibility with the real myPOS wire format.
 */
class SignedMyPosGatewayFake implements MyPosCheckoutGateway {
	readonly callbackResults = new Map<string, VerifiedPaymentEvent>();
	readonly refundResults = new Map<string, RefundResult>();

	constructor(private readonly signingSecret: string) {}

	sign(rawBody: string): string {
		return createHmac('sha256', this.signingSecret).update(rawBody).digest('hex');
	}

	async createCheckout(request: CheckoutRequest): Promise<CheckoutSession> {
		return {
			provider: 'mypos',
			externalPaymentId: `mypos-${request.paymentId}`,
			checkoutUrl: `https://sandbox.mypos.example/checkout/${request.paymentId}`,
			state: 'pending'
		};
	}

	async verifyCallback(payload: CallbackPayload): Promise<VerifiedPaymentEvent> {
		const rawBody =
			typeof payload.rawBody === 'string'
				? payload.rawBody
				: new TextDecoder().decode(payload.rawBody);
		const supplied = payload.headers['x-test-signature'] ?? '';
		const expected = this.sign(rawBody);
		const suppliedBytes = Buffer.from(supplied, 'hex');
		const expectedBytes = Buffer.from(expected, 'hex');
		if (
			suppliedBytes.length !== expectedBytes.length ||
			!timingSafeEqual(suppliedBytes, expectedBytes)
		) {
			throw new Error('invalid_test_signature');
		}

		const parsed = JSON.parse(rawBody) as {
			eventId: string;
			externalPaymentId: string;
			outcome: 'approved' | 'declined';
			idempotencyKey: string;
		};
		const duplicate = this.callbackResults.get(parsed.eventId);
		if (duplicate) return duplicate;

		const result: VerifiedPaymentEvent = {
			provider: 'mypos',
			eventId: parsed.eventId,
			externalPaymentId: parsed.externalPaymentId,
			state: parsed.outcome === 'approved' ? 'paid' : 'failed',
			amountMinor: 199,
			currency: 'EUR',
			idempotencyKey: parsed.idempotencyKey,
			occurredAt: '2026-07-21T12:00:00.000Z'
		};
		this.callbackResults.set(parsed.eventId, result);
		return result;
	}

	async getPaymentStatus(externalPaymentId: string): Promise<PaymentStatus> {
		const event = [...this.callbackResults.values()].find(
			(candidate) => candidate.externalPaymentId === externalPaymentId
		);
		return {
			provider: 'mypos',
			externalPaymentId,
			state: event?.state ?? 'pending',
			amountMinor: event?.amountMinor ?? 199,
			currency: 'EUR'
		};
	}

	async refund(request: RefundRequest): Promise<RefundResult> {
		const duplicate = this.refundResults.get(request.idempotencyKey);
		if (duplicate) return duplicate;
		const result: RefundResult = {
			provider: 'mypos',
			externalRefundId: `refund-${request.idempotencyKey}`,
			externalPaymentId: request.externalPaymentId,
			state: 'succeeded',
			amountMinor: request.amountMinor ?? 199
		};
		this.refundResults.set(request.idempotencyKey, result);
		return result;
	}
}

describe('closed-beta feature gates', () => {
	it.each(['1', 'true', 'TRUE', ' yes ', 'on'])('parses enabled value %j', (value) => {
		expect(parseBooleanFlag(value)).toBe(true);
	});

	it.each(['0', 'false', 'FALSE', ' no ', 'off'])('parses disabled value %j', (value) => {
		expect(parseBooleanFlag(value, true)).toBe(false);
	});

	it('falls back for missing and unknown environment values', () => {
		expect(parseBooleanFlag(undefined)).toBe(false);
		expect(parseBooleanFlag('maybe', true)).toBe(true);
	});

	it('keeps every revenue feature disabled by default', () => {
		expect(resolveFeatureFlags({})).toEqual(DEFAULT_FEATURE_FLAGS);
	});

	it('requires both global billing and the specific paid-feature flag', () => {
		expect(isPaidFeatureEnabled(flags({ listingFees: true }), 'listingFees')).toBe(false);
		expect(
			isPaidFeatureEnabled(flags({ billing: true, listingFees: true }), 'listingFees')
		).toBe(true);
	});
});

describe('payment adapter boundary', () => {
	it('returns the disabled adapter whenever global billing is off', async () => {
		const adapter = createPaymentAdapter(
			'mypos',
			flags({ myposPayments: true })
		);

		expect(adapter.provider).toBe('disabled');
		expect(adapter.enabled).toBe(false);
		await expect(adapter.createCheckout(checkoutRequest)).rejects.toBeInstanceOf(
			PaymentsDisabledError
		);
	});

	it('refuses enabled myPOS without an explicitly injected audited gateway', () => {
		const adapter = createPaymentAdapter(
			'mypos',
			flags({ billing: true, myposPayments: true })
		);

		expect(adapter.enabled).toBe(true);
		expect(() => adapter.createCheckout(checkoutRequest)).toThrow(PaymentConfigurationError);
	});

	it('forwards the original idempotency key unchanged through the myPOS port', async () => {
		const createCheckout = vi.fn(async (request: CheckoutRequest) => ({
			provider: 'mypos' as const,
			externalPaymentId: `mypos-${request.paymentId}`,
			checkoutUrl: 'https://sandbox.mypos.example/checkout/1',
			state: 'pending' as const
		}));
		const gateway: MyPosCheckoutGateway = {
			createCheckout,
			verifyCallback: vi.fn(),
			getPaymentStatus: vi.fn(),
			refund: vi.fn()
		};
		const adapter = createPaymentAdapter(
			'mypos',
			flags({ billing: true, myposPayments: true }),
			{ mypos: gateway }
		);

		await expect(adapter.createCheckout(checkoutRequest)).resolves.toMatchObject({
			provider: 'mypos',
			externalPaymentId: 'mypos-payment-1',
			state: 'pending'
		});
		expect(createCheckout).toHaveBeenCalledTimes(1);
		expect(createCheckout).toHaveBeenCalledWith(
			expect.objectContaining({ idempotencyKey: 'checkout:payment-1:v1' })
		);
	});

	it('keeps Stripe fallback disabled unless its dedicated flag is enabled', () => {
		const adapter = createPaymentAdapter('stripe', flags({ billing: true }));
		expect(adapter.provider).toBe('stripe');
		expect(adapter.enabled).toBe(false);
		expect(() => adapter.createCheckout(checkoutRequest)).toThrow(PaymentsDisabledError);
	});

	it('maps signed approved and declined callbacks while replaying duplicates idempotently', async () => {
		const gateway = new SignedMyPosGatewayFake('local-test-secret');
		const adapter = createPaymentAdapter(
			'mypos',
			flags({ billing: true, myposPayments: true }),
			{ mypos: gateway }
		);
		const approvedBody = JSON.stringify({
			eventId: 'event-approved',
			externalPaymentId: 'mypos-payment-1',
			outcome: 'approved',
			idempotencyKey: checkoutRequest.idempotencyKey
		});
		const approvedPayload = {
			headers: { 'x-test-signature': gateway.sign(approvedBody) },
			rawBody: approvedBody
		};

		const approved = await adapter.verifyCallback(approvedPayload);
		const duplicate = await adapter.verifyCallback(approvedPayload);
		expect(approved.state).toBe('paid');
		expect(duplicate).toBe(approved);
		expect(gateway.callbackResults.size).toBe(1);

		const declinedBody = JSON.stringify({
			eventId: 'event-declined',
			externalPaymentId: 'mypos-payment-2',
			outcome: 'declined',
			idempotencyKey: 'checkout:payment-2:v1'
		});
		await expect(
			adapter.verifyCallback({
				headers: { 'x-test-signature': gateway.sign(declinedBody) },
				rawBody: declinedBody
			})
		).resolves.toMatchObject({ state: 'failed', eventId: 'event-declined' });
	});

	it('rejects an invalid callback signature and makes refund retries idempotent', async () => {
		const gateway = new SignedMyPosGatewayFake('local-test-secret');
		const adapter = createPaymentAdapter(
			'mypos',
			flags({ billing: true, myposPayments: true }),
			{ mypos: gateway }
		);
		await expect(
			adapter.verifyCallback({
				headers: { 'x-test-signature': '00'.repeat(32) },
				rawBody: '{"eventId":"tampered"}'
			})
		).rejects.toThrow('invalid_test_signature');

		const refundRequest: RefundRequest = {
			externalPaymentId: 'mypos-payment-1',
			amountMinor: 199,
			reason: 'duplicate test',
			idempotencyKey: 'refund:payment-1:v1'
		};
		const first = await adapter.refund(refundRequest);
		const retry = await adapter.refund(refundRequest);
		expect(first).toMatchObject({ state: 'succeeded', amountMinor: 199 });
		expect(retry).toBe(first);
		expect(gateway.refundResults.size).toBe(1);
	});
});
