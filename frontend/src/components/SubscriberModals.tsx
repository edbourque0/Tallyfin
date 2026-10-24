import { FormEvent, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { dateShort, money, today } from '../lib/format';
import type { Payment, Plan, StatusOverride, Subscriber } from '../lib/types';
import { ErrorBanner, Field, Modal, useToast } from './ui';

export function invalidateSubscriberData(qc: ReturnType<typeof useQueryClient>, id?: number) {
  qc.invalidateQueries({ queryKey: ['subscribers'] });
  qc.invalidateQueries({ queryKey: ['dashboard'] });
  qc.invalidateQueries({ queryKey: ['payments'] });
  qc.invalidateQueries({ queryKey: ['profitability'] });
  qc.invalidateQueries({ queryKey: ['reminders'] });
  qc.invalidateQueries({ queryKey: ['plans'] });
  if (id !== undefined) qc.invalidateQueries({ queryKey: ['subscriber', id] });
}

export function SubscriptionModal({ subscriber, plans, onClose }: { subscriber: Subscriber; plans: Plan[]; onClose: () => void }) {
  const qc = useQueryClient();
  const { push: toast } = useToast();
  const [planId, setPlanId] = useState<string>(subscriber.plan ? String(subscriber.plan.id) : '');
  const [nextDate, setNextDate] = useState(subscriber.next_payment_date ?? '');
  const [startDate, setStartDate] = useState(subscriber.subscription_start ?? '');
  const [override, setOverride] = useState<StatusOverride>(subscriber.status_override);
  const [exemptUntil, setExemptUntil] = useState(subscriber.exempt_until ?? '');
  const [email, setEmail] = useState(subscriber.email);
  const [contact, setContact] = useState(subscriber.contact);
  const [notes, setNotes] = useState(subscriber.notes);
  const [tracearrId, setTracearrId] = useState(subscriber.tracearr_user_id);
  const [seerrId, setSeerrId] = useState(subscriber.seerr_user_id === null ? '' : String(subscriber.seerr_user_id));
  const [advanced, setAdvanced] = useState(false);

  const save = useMutation({
    mutationFn: () =>
      api.patch<Subscriber>(`/api/subscribers/${subscriber.id}/`, {
        plan_id: planId ? Number(planId) : null,
        next_payment_date: nextDate || null,
        subscription_start: startDate || null,
        status_override: override,
        exempt_until: override === 'exempt' && exemptUntil ? exemptUntil : null,
        email,
        contact,
        notes,
        tracearr_user_id: tracearrId.trim(),
        seerr_user_id: seerrId.trim() ? Number(seerrId) : null,
      }),
    onSuccess: () => {
      invalidateSubscriberData(qc, subscriber.id);
      toast('Subscription saved', 'ok');
      onClose();
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  const selectedPlan = plans.find((p) => String(p.id) === planId);

  return (
    <Modal title={`Subscription — ${subscriber.name}`} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <ErrorBanner error={save.error} />
        <Field label="Plan" help={selectedPlan ? `${money(selectedPlan.price, selectedPlan.currency)} every ${selectedPlan.duration_label} (≈ ${money(selectedPlan.monthly_price, selectedPlan.currency)}/month)` : 'No plan: the user is not billed.'}>
          <select value={planId} onChange={(e) => setPlanId(e.target.value)}>
            <option value="">— No plan —</option>
            {plans
              .filter((p) => p.is_active || String(p.id) === planId)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {money(p.price, p.currency)} / {p.duration_label}
                </option>
              ))}
          </select>
        </Field>
        <div className="field-row">
          <Field label="Next payment due" help="Defaults to today when a plan is first assigned.">
            <input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} />
          </Field>
          <Field label="Subscribed since">
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
        </div>
        <Field label="Billing status" help="Exempt users are never reminded or counted in revenue (family, admins, trials).">
          <select value={override} onChange={(e) => setOverride(e.target.value as StatusOverride)}>
            <option value="">Billed normally</option>
            <option value="exempt">Exempt (free account)</option>
            <option value="paused">Paused</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </Field>
        {override === 'exempt' && (
          <Field label="Exempt until" help="Leave blank for permanent free access. After this date the exemption counts as expired and, with enforcement on, the Jellyfin account is disabled.">
            <input type="date" value={exemptUntil} onChange={(e) => setExemptUntil(e.target.value)} />
          </Field>
        )}
        <div className="field-row">
          <Field label="Email">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="optional" />
          </Field>
          <Field label="Contact">
            <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Discord, phone…" />
          </Field>
        </div>
        <Field label="Notes">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setAdvanced(!advanced)}>
          {advanced ? 'Hide' : 'Show'} matching overrides
        </button>
        {advanced && (
          <div className="field-row">
            <Field label="Tracearr user id" help="Only needed if automatic matching picked the wrong identity.">
              <input value={tracearrId} onChange={(e) => setTracearrId(e.target.value)} placeholder="auto" />
            </Field>
            <Field label="Seerr user id">
              <input value={seerrId} onChange={(e) => setSeerrId(e.target.value)} placeholder="auto" inputMode="numeric" />
            </Field>
          </div>
        )}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function PaymentModal({ subscriber, currency, onClose }: { subscriber: Subscriber; currency: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { push: toast } = useToast();
  const plan = subscriber.plan;
  const todayStr = today();
  const defaultStart = subscriber.next_payment_date && subscriber.next_payment_date >= todayStr ? subscriber.next_payment_date : todayStr;

  const [amount, setAmount] = useState(plan ? String(plan.price) : '');
  const [paidAt, setPaidAt] = useState(todayStr);
  const [periodStart, setPeriodStart] = useState(defaultStart);
  const [method, setMethod] = useState('');
  const [note, setNote] = useState('');
  const [advance, setAdvance] = useState(true);

  const save = useMutation({
    mutationFn: () =>
      api.post<{ payment: Payment; subscriber: Subscriber; access_restored: boolean; access_error: string | null }>(`/api/subscribers/${subscriber.id}/payments/`, {
        amount: amount === '' ? undefined : Number(amount),
        currency: plan?.currency ?? currency,
        paid_at: paidAt,
        period_start: periodStart || null,
        method,
        note,
        advance_due_date: advance,
      }),
    onSuccess: (data) => {
      invalidateSubscriberData(qc, subscriber.id);
      toast(`Payment recorded. Next due ${dateShort(data.subscriber.next_payment_date)}.${data.access_restored ? ' Jellyfin access restored.' : ''}`, 'ok');
      if (data.access_error) toast(`Could not restore Jellyfin access: ${data.access_error}`, 'error');
      onClose();
    },
  });

  return (
    <Modal title={`Record payment — ${subscriber.name}`} onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <ErrorBanner error={save.error} />
        {!plan && <div className="banner banner-warn">This subscriber has no plan. The payment is recorded but the due date cannot be advanced.</div>}
        <div className="field-row">
          <Field label={`Amount (${plan?.currency ?? currency})`}>
            <input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} required={!plan} />
          </Field>
          <Field label="Paid on">
            <input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} required />
          </Field>
        </div>
        {plan && (
          <Field
            label="Period starts"
            help={subscriber.next_payment_date && subscriber.next_payment_date >= todayStr ? 'Paying early: the new period starts when the current one ends.' : 'Covers one plan period from this date.'}
          >
            <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
          </Field>
        )}
        <div className="field-row">
          <Field label="Method">
            <input value={method} onChange={(e) => setMethod(e.target.value)} placeholder="e-transfer, cash, PayPal…" list="payment-methods" />
            <datalist id="payment-methods">
              <option value="e-transfer" />
              <option value="cash" />
              <option value="PayPal" />
              <option value="bank transfer" />
              <option value="crypto" />
            </datalist>
          </Field>
          <Field label="Note">
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" />
          </Field>
        </div>
        {plan && (
          <label className="check">
            <input type="checkbox" checked={advance} onChange={(e) => setAdvance(e.target.checked)} />
            Move the next payment date to the end of this period ({plan.duration_label} after period start)
          </label>
        )}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Record payment'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
