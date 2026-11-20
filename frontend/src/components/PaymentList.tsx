import { Link } from 'react-router-dom';
import { dateShort, money } from '../lib/format';
import type { Payment } from '../lib/types';

const TRASH = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M3 6h18" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

/**
 * Payments as a list: amount and date first, period and method underneath, delete always reachable.
 * Used where a table would be cramped (inside cards, narrow screens).
 */
export function PaymentList({
  payments,
  onDelete,
  showName,
}: {
  payments: Payment[];
  onDelete: (p: Payment) => void;
  /** Show whose payment it is (ledger); off on a subscriber's own page. */
  showName?: boolean;
}) {
  return (
    <ul className="pay-list">
      {payments.map((p) => {
        const meta = [
          p.period_start ? `Covers ${dateShort(p.period_start)} – ${dateShort(p.period_end)}` : null,
          showName ? p.plan_name : null,
          p.method || null,
        ].filter(Boolean);
        return (
          <li key={p.id} className="pay-item">
            <div className="pay-main">
              <div className="pay-line">
                {showName ? (
                  <Link className="pay-who" to={`/subscribers/${p.subscriber}`}>
                    {p.subscriber_name}
                  </Link>
                ) : (
                  <span className="pay-when">{dateShort(p.paid_at)}</span>
                )}
                <span className="pay-amount">{money(p.amount, p.currency)}</span>
              </div>
              <div className="pay-meta">{[showName ? dateShort(p.paid_at) : null, ...meta].filter(Boolean).join(' · ')}</div>
              {p.note && <div className="pay-note">{p.note}</div>}
            </div>
            <button
              type="button"
              className="icon-btn"
              onClick={() => onDelete(p)}
              aria-label={`Delete ${money(p.amount, p.currency)} payment${showName ? ` from ${p.subscriber_name}` : ''} on ${dateShort(p.paid_at)}`}
              title="Delete payment"
            >
              {TRASH}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
