import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { money } from '../lib/format';
import type { AppSettings, DurationUnit, Plan } from '../lib/types';
import { Card, EmptyState, ErrorBanner, Field, Modal, Spinner, useToast } from '../components/ui';

interface PlanForm {
  name: string;
  description: string;
  price: string;
  currency: string;
  duration_value: string;
  duration_unit: DurationUnit;
  is_active: boolean;
  sort_order: string;
}

function toForm(plan: Plan | null, currency: string): PlanForm {
  return {
    name: plan?.name ?? '',
    description: plan?.description ?? '',
    price: plan ? String(plan.price) : '',
    currency: plan?.currency ?? currency,
    duration_value: String(plan?.duration_value ?? 1),
    duration_unit: plan?.duration_unit ?? 'month',
    is_active: plan?.is_active ?? true,
    sort_order: String(plan?.sort_order ?? 0),
  };
}

export function PlansPage() {
  const qc = useQueryClient();
  const { push: toast } = useToast();
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => api.get<Plan[]>('/api/plans/') });
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.get<AppSettings>('/api/settings/') });
  const [modal, setModal] = useState<{ plan: Plan | null } | null>(null);

  const remove = useMutation({
    mutationFn: (id: number) => api.del(`/api/plans/${id}/`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plans'] });
      qc.invalidateQueries({ queryKey: ['subscribers'] });
      toast('Plan deleted', 'ok');
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  if (plans.isLoading) return <Spinner label="Loading plans…" />;
  if (plans.error) return <ErrorBanner error={plans.error} />;
  const list = plans.data ?? [];

  return (
    <div className="stack">
      <div className="row-between">
        <p className="text-muted">A plan is a price for a period of access. Assign one to each subscriber; recording a payment extends their due date by one period.</p>
        <button className="btn btn-primary" onClick={() => setModal({ plan: null })}>
          New plan
        </button>
      </div>
      {list.length === 0 ? (
        <Card>
          <EmptyState title="No plans yet">Create your first plan, for example “Monthly – 10 USD / month” or “Yearly – 100 USD / year”.</EmptyState>
        </Card>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Plan</th>
                <th className="num">Price</th>
                <th>Period</th>
                <th className="num">≈ per month</th>
                <th className="num">Subscribers</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div className="strong">{p.name}</div>
                    {p.description && <div className="small text-muted">{p.description}</div>}
                  </td>
                  <td className="num strong">{money(p.price, p.currency)}</td>
                  <td>every {p.duration_label}</td>
                  <td className="num">{money(p.monthly_price, p.currency)}</td>
                  <td className="num">{p.subscriber_count}</td>
                  <td>{p.is_active ? <span className="badge badge-active">active</span> : <span className="badge badge-neutral">archived</span>}</td>
                  <td>
                    <div className="actions">
                      <button className="btn btn-sm" onClick={() => setModal({ plan: p })}>
                        Edit
                      </button>
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={() => {
                          const warning = p.subscriber_count > 0 ? ` ${p.subscriber_count} subscriber(s) will lose their plan.` : '';
                          if (window.confirm(`Delete plan “${p.name}”?${warning}`)) remove.mutate(p.id);
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {modal && <PlanModal plan={modal.plan} currency={settings.data?.currency ?? 'USD'} onClose={() => setModal(null)} />}
    </div>
  );
}

function PlanModal({ plan, currency, onClose }: { plan: Plan | null; currency: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { push: toast } = useToast();
  const [form, setForm] = useState<PlanForm>(() => toForm(plan, currency));
  const set = <K extends keyof PlanForm>(key: K, value: PlanForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...form,
        price: Number(form.price),
        duration_value: Number(form.duration_value),
        sort_order: Number(form.sort_order || 0),
      };
      return plan ? api.patch<Plan>(`/api/plans/${plan.id}/`, body) : api.post<Plan>('/api/plans/', body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plans'] });
      qc.invalidateQueries({ queryKey: ['subscribers'] });
      toast(plan ? 'Plan updated' : 'Plan created', 'ok');
      onClose();
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  const days = { day: 1, week: 7, month: 30.4375, year: 365.25 }[form.duration_unit] * (Number(form.duration_value) || 1);
  const monthly = form.price ? (Number(form.price) / days) * 30.4375 : 0;

  return (
    <Modal title={plan ? `Edit plan — ${plan.name}` : 'New plan'} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <ErrorBanner error={save.error} />
        <Field label="Name">
          <input value={form.name} onChange={(e) => set('name', e.target.value)} required autoFocus placeholder="Monthly" />
        </Field>
        <div className="field-row">
          <Field label="Price">
            <input type="number" min="0" step="0.01" value={form.price} onChange={(e) => set('price', e.target.value)} required />
          </Field>
          <Field label="Currency">
            <input value={form.currency} onChange={(e) => set('currency', e.target.value.toUpperCase())} maxLength={8} required />
          </Field>
        </div>
        <div className="field-row">
          <Field label="Period length">
            <input type="number" min="1" value={form.duration_value} onChange={(e) => set('duration_value', e.target.value)} required />
          </Field>
          <Field label="Unit">
            <select value={form.duration_unit} onChange={(e) => set('duration_unit', e.target.value as DurationUnit)}>
              <option value="day">day(s)</option>
              <option value="week">week(s)</option>
              <option value="month">month(s)</option>
              <option value="year">year(s)</option>
            </select>
          </Field>
        </div>
        <div className="help">≈ {money(monthly, form.currency || currency)} per month</div>
        <Field label="Description">
          <textarea value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="What is included (streams, 4K, requests…)" />
        </Field>
        <div className="field-row">
          <Field label="Sort order">
            <input type="number" value={form.sort_order} onChange={(e) => set('sort_order', e.target.value)} />
          </Field>
          <label className="check" style={{ alignSelf: 'end', paddingBottom: 8 }}>
            <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} /> Active (selectable for new subscribers)
          </label>
        </div>
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : plan ? 'Save changes' : 'Create plan'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
