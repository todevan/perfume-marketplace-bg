// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ListingCardDto } from '../../src/lib/contracts';
import ListingCard from '../../src/lib/components/ListingCard.svelte';

const offer: ListingCardDto = {
  id: 'listing-1',
  slug: 'dior-sauvage-edp-100',
  kind: 'offer',
  dealMode: 'sale_or_swap',
  title: 'Dior Sauvage',
  brandId: 'brand-dior',
  brandName: 'Dior',
  brandSlug: 'dior',
  fragranceName: 'Sauvage',
  concentration: 'EDP',
  city: 'София',
  price: { amountMinor: 7600, currency: 'EUR' },
  maxBudget: null,
  bottleVolumeMl: 100,
  remainingMl: 82,
  isSealed: false,
  status: 'active',
  seller: {
    id: 'seller-1',
    username: 'north_notes',
    avatarUrl: null,
    accountKind: 'private',
    merchantVerified: false
  },
  primaryPhoto: {
    id: 'photo-1',
    imageUrl: 'https://images.example/dior-sauvage.jpg',
    role: 'product_full',
    sortOrder: 0
  },
  authenticityReviewed: true,
  createdAt: '2026-07-20T12:00:00.000Z'
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

describe('ListingCard', () => {
  it('renders composition-three listing facts and canonical actions', () => {
    const { container } = render(ListingCard, { listing: offer, variant: 'featured' });
    const article = container.querySelector('article.listing-card');

    expect(article).not.toBeNull();
    expect(article?.getAttribute('data-variant')).toBe('featured');
    expect(article?.getAttribute('aria-labelledby')).toBe(
      container.querySelector('.title-link')?.getAttribute('id')
    );

    expect(screen.getByRole('img', { name: 'Dior Sauvage' })).toBeTruthy();
    expect(screen.getByText('Dior')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Sauvage' })).toBeTruthy();
    expect(screen.getByText('EDP')).toBeTruthy();
    expect(screen.getByText('100 ml')).toBeTruthy();
    expect(screen.getByText('82 ml (82%)')).toBeTruthy();
    expect(screen.getByText(/76,00/)).toBeTruthy();
    expect(container.querySelector('.deal-mode')?.textContent).toContain('Продажба или размяна');
    expect(screen.getByText('София')).toBeTruthy();
    expect(screen.getByRole('link', { name: '@north_notes' }).getAttribute('href')).toBe(
      '/profile/north_notes'
    );
    expect(screen.getByText('Частно лице')).toBeTruthy();
    expect(screen.getByText('Доказателствата са прегледани')).toBeTruthy();

    const canonicalHref = '/listing/dior-sauvage-edp-100';
    expect(container.querySelector('.image-link')?.getAttribute('href')).toBe(canonicalHref);
    expect(container.querySelector('.title-link')?.getAttribute('href')).toBe(canonicalHref);
    expect(screen.getByRole('link', { name: 'Виж обявата' }).getAttribute('href')).toBe(
      canonicalHref
    );

    const favorite = screen.getByRole('button', {
      name: 'Добави Dior Sauvage в любими'
    });
    expect(favorite.getAttribute('type')).toBe('submit');
    expect(favorite.closest('form')?.getAttribute('method')?.toLowerCase()).toBe('post');
    expect(favorite.closest('form')?.getAttribute('action')).toBe(
      '/listing/dior-sauvage-edp-100?/favorite'
    );
    expect(favorite.getAttribute('aria-pressed')).toBe('false');
  });

  it('formats unspecified concentration without exposing the raw enum', () => {
    render(ListingCard, {
      listing: { ...offer, concentration: 'OTHER_NOT_STATED' }
    });

    expect(screen.getByText('Концентрацията не е посочена')).toBeTruthy();
    expect(screen.queryByText('OTHER_NOT_STATED')).toBeNull();
  });

  it('updates favorite state in place after an enhanced action', async () => {
    window.history.replaceState({}, '', '/listings?sort=price-asc&city=Sofia');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ type: 'success', status: 200 }))
    );
    vi.stubGlobal('fetch', fetchMock);
    render(ListingCard, { listing: offer });

    const favorite = screen.getByRole('button', {
      name: 'Добави Dior Sauvage в любими'
    });
    await fireEvent.click(favorite);

    await waitFor(() => expect(favorite.getAttribute('aria-pressed')).toBe('true'));
    expect(favorite.getAttribute('aria-label')).toBe('Премахни Dior Sauvage от любими');
    expect(favorite.closest('form')?.getAttribute('action')).toBe(
      '/listing/dior-sauvage-edp-100?/unfavorite'
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(`${window.location.pathname}${window.location.search}`).toBe(
      '/listings?sort=price-asc&city=Sofia'
    );
  });

  it('shows favorite action errors without leaving the current page', async () => {
    window.history.replaceState({}, '', '/listings?kind=offer&page=2');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ type: 'failure', status: 503 }))
      )
    );
    render(ListingCard, { listing: offer });

    await fireEvent.click(
      screen.getByRole('button', { name: 'Добави Dior Sauvage в любими' })
    );

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Не успяхме да обновим любимите. Опитай отново.'
    );
    expect(`${window.location.pathname}${window.location.search}`).toBe(
      '/listings?kind=offer&page=2'
    );
  });

  it('keeps the legacy compact boolean while an explicit variant takes precedence', () => {
    const compactRender = render(ListingCard, { listing: offer, compact: true });
    expect(
      compactRender.container.querySelector('article.listing-card')?.getAttribute('data-variant')
    ).toBe('compact');
    compactRender.unmount();

    const explicitRender = render(ListingCard, {
      listing: offer,
      compact: true,
      variant: 'catalog'
    });
    expect(
      explicitRender.container.querySelector('article.listing-card')?.getAttribute('data-variant')
    ).toBe('catalog');
  });

  it('uses the exact swap-only value without hiding the full deal mode', () => {
    const swapOnly: ListingCardDto = {
      ...offer,
      id: 'listing-2',
      slug: 'tom-ford-oud-wood-swap',
      dealMode: 'swap',
      price: null,
      authenticityReviewed: false
    };

    const { container } = render(ListingCard, { listing: swapOnly, variant: 'catalog' });

    expect(screen.getByText('Само размяна')).toBeTruthy();
    expect(container.querySelector('.deal-mode')?.textContent).toContain('Размяна');
    expect(screen.queryByText('Доказателствата са прегледани')).toBeNull();
  });

  it('labels only demo listing photos as synthetic without changing the DTO', () => {
    const demoListing: ListingCardDto = {
      ...offer,
      id: 'listing-demo',
      slug: 'demo-dior-sauvage',
      primaryPhoto: {
        ...offer.primaryPhoto!,
        id: 'photo-demo',
        imageUrl: '/demo/listings/dior-sauvage.webp'
      }
    };

    const demoRender = render(ListingCard, { listing: demoListing });
    expect(screen.getByText('СИНТЕТИЧНА СНИМКА')).toBeTruthy();
    demoRender.unmount();

    render(ListingCard, { listing: offer });
    expect(screen.queryByText('СИНТЕТИЧНА СНИМКА')).toBeNull();
  });

  it('preserves wanted budget and requested-volume semantics', () => {
    const wanted: ListingCardDto = {
      ...offer,
      id: 'wanted-1',
      slug: 'wanted-xerjoff-naxos',
      kind: 'wanted',
      dealMode: 'sale',
      price: null,
      maxBudget: { amountMinor: 12000, currency: 'EUR' },
      remainingMl: null,
      authenticityReviewed: false
    };

    const { container } = render(ListingCard, { listing: wanted, variant: 'compact' });

    expect(container.querySelector('article.listing-card')?.classList.contains('wanted')).toBe(true);
    expect(container.querySelector('.deal-label')?.textContent).toBe('Търся');
    expect(screen.getByText(/До 120,00/)).toBeTruthy();
    expect(screen.getByText('Желан остатък не е посочен')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Виж обявата' }).getAttribute('href')).toBe(
      '/listing/wanted-xerjoff-naxos'
    );
  });
});
