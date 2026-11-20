import { useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { dateShort, money } from './format';
import type { Payment } from './types';
import { useToast } from '../components/ui';
import { invalidateSubscriberData } from '../components/SubscriberModals';

/** How long "Undo" stays available before a deleted payment is really deleted. */
export const UNDO_MS = 6000;

// Payments deleted in the UI but not yet on the server. Module-level so the countdown, and the hidden
// row, survive navigating between pages; flushed with keepalive requests if the tab is closed.
const pending = new Map<number, { timer: number; path: string }>();
const listeners = new Set<() => void>();
let snapshot: ReadonlySet<number> = new Set();

function emit() {
  snapshot = new Set(pending.keys());
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    pending.forEach(({ timer, path }) => {
      window.clearTimeout(timer);
      api.deleteOnUnload(path);
    });
    pending.clear();
  });
}

/** Ids of payments waiting out their undo window; lists should hide these rows. */
export function usePendingPaymentDeletes(): ReadonlySet<number> {
  return useSyncExternalStore(subscribe, () => snapshot);
}

/** Delete a payment with a few seconds to undo, instead of a confirm() prompt. */
export function useDeletePayment() {
  const qc = useQueryClient();
  const { push } = useToast();

  return (payment: Payment) => {
    if (pending.has(payment.id)) return;
    const path = `/api/payments/${payment.id}/`;

    const commit = async () => {
      try {
        const result = await api.del<{ due_date_reverted: boolean; next_payment_date: string | null }>(path);
        await invalidateSubscriberData(qc, payment.subscriber);
        if (result?.due_date_reverted) {
          push(`${payment.subscriber_name}'s next payment is due ${dateShort(result.next_payment_date)} again.`, 'info');
        }
      } catch (err) {
        push(`Couldn't delete the payment. ${err instanceof Error ? err.message : ''}`.trim(), 'error');
      } finally {
        pending.delete(payment.id);
        emit();
      }
    };

    const timer = window.setTimeout(commit, UNDO_MS);
    pending.set(payment.id, { timer, path });
    emit();

    push(`Deleted ${money(payment.amount, payment.currency)} from ${payment.subscriber_name}.`, 'info', {
      duration: UNDO_MS,
      action: {
        label: 'Undo',
        onClick: () => {
          window.clearTimeout(timer);
          pending.delete(payment.id);
          emit();
        },
      },
    });
  };
}
