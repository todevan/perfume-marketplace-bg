// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';

import MemberShell from '../../src/lib/components/MemberShell.svelte';

const auth = {
  profile: {
    username: 'scent_archive',
    phoneVerifiedAt: '2026-07-22T12:00:00Z'
  }
};

afterEach(() => cleanup());

describe('member shell', () => {
  it('keeps the complete dashboard menu and marks the current standard route', () => {
    render(MemberShell, { auth, pathname: '/offers', mode: 'standard' });

    const navigation = screen.getByRole('navigation', { name: 'Потребителска зона' });
    const labels = [
      'Преглед',
      'Моите обяви',
      'Оферти',
      'Сделки',
      'Съобщения',
      'Любими',
      'Запазени търсения',
      'Отзиви',
      'Известия',
      'Настройки'
    ];

    for (const label of labels) {
      expect(within(navigation).getByRole('link', { name: label })).toBeTruthy();
    }

    expect(within(navigation).getByRole('link', { name: 'Оферти' }).getAttribute('aria-current')).toBe('page');
    expect(within(navigation).getByRole('link', { name: 'Преглед' }).hasAttribute('aria-current')).toBe(false);
  });

  it('uses a compact workspace bar for messages', () => {
    const { container } = render(MemberShell, { auth, pathname: '/messages', mode: 'workspace' });

    expect(container.querySelector('[data-member-mode="workspace"]')).not.toBeNull();
    expect(screen.getByRole('navigation', { name: 'Навигация в работното пространство' })).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Потребителска зона' })).toBeNull();
  });

  it('uses the focus header for publishing without the standard member rail', () => {
    const { container } = render(MemberShell, { auth, pathname: '/publish', mode: 'focus' });

    expect(container.querySelector('[data-member-mode="focus"]')).not.toBeNull();
    expect(screen.getByRole('navigation', { name: 'Навигация при публикуване' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Към личния панел' }).getAttribute('href')).toBe('/dashboard');
    expect(screen.queryByRole('navigation', { name: 'Потребителска зона' })).toBeNull();
  });
});
