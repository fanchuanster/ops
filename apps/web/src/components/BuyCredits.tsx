'use client'

import { useEffect, useState, useTransition } from 'react'
import { renderSVG } from 'uqr'

import {
  checkPurchase,
  startPurchase,
  type Invoice,
} from '../app/(frontend)/actions/credits'
import {
  COINS,
  MAX_PURCHASE_CREDITS,
  MIN_PURCHASE_CREDITS,
  QUICK_AMOUNTS,
  coinLabel,
  type CoinId,
} from '../domain/creditPurchases'

const POLL_MS = 6000

type Stage =
  | { name: 'select' }
  | { name: 'invoice'; invoice: Invoice }
  | { name: 'paid'; credits: number; balance: number }
  | { name: 'ended'; reason: 'failed' | 'expired' }

export function BuyCredits({ resume }: { resume: Invoice | null }) {
  const [stage, setStage] = useState<Stage>(resume ? { name: 'invoice', invoice: resume } : { name: 'select' })
  const [credits, setCredits] = useState<number>(25)
  const [coin, setCoin] = useState<CoinId>('btc')
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [pending, startTransition] = useTransition()

  const orderId = stage.name === 'invoice' ? stage.invoice.orderId : null
  const invoiceCredits = stage.name === 'invoice' ? stage.invoice.credits : 0

  useEffect(() => {
    if (!orderId) return
    const timer = window.setInterval(async () => {
      const result = await checkPurchase(orderId)
      if (result.status === 'paid') {
        setStage({ name: 'paid', credits: invoiceCredits, balance: result.balance ?? 0 })
        return
      }
      if (result.status !== 'pending') setStage({ name: 'ended', reason: result.status })
    }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [orderId, invoiceCredits])

  function begin() {
    setError(null)
    startTransition(async () => {
      const result = await startPurchase(credits, coin)
      if (result.error || !result.invoice) {
        setError(result.error ?? 'Could not start the payment.')
        return
      }
      setCopied(false)
      setStage({ name: 'invoice', invoice: result.invoice })
    })
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  if (stage.name === 'paid') {
    return (
      <div className="buy-card buy-card--done">
        <h3>Payment received</h3>
        <p>{`${stage.credits} credits were added to your account.`}</p>
        <p className="buy-balance">
          <strong>{stage.balance}</strong>
          <span>New balance</span>
        </p>
        <div className="buy-actions">
          <button type="button" className="button-quiet" onClick={() => setStage({ name: 'select' })}>
            Buy more credits
          </button>
          <a className="cta cta--compact" href="/account/books">
            Back to my books
          </a>
        </div>
      </div>
    )
  }

  if (stage.name === 'ended') {
    return (
      <div className="buy-card">
        <h3>{stage.reason === 'expired' ? 'That payment expired' : 'That payment did not go through'}</h3>
        <p className="hint">
          Nothing was added to your balance. If you sent funds, they are returned by the payment
          service to the sending address.
        </p>
        <div className="buy-actions">
          <button type="button" className="cta cta--compact" onClick={() => setStage({ name: 'select' })}>
            Start again
          </button>
        </div>
      </div>
    )
  }

  if (stage.name === 'invoice') {
    const { invoice } = stage
    const label = coinLabel(invoice.payCurrency)
    return (
      <div className="buy-card">
        <h3>Complete your payment</h3>
        <p className="hint">Send the exact amount below. Your credits arrive automatically.</p>

        <div className="buy-invoice">
          <div
            className="buy-qr"
            role="img"
            aria-label={`QR code for the ${label} address`}
            dangerouslySetInnerHTML={{ __html: renderSVG(invoice.payAddress, { border: 1 }) }}
          />
          <dl className="buy-details">
            <div>
              <dt>Amount due</dt>
              <dd>{`${invoice.payAmount} ${label}`}</dd>
              <dd className="hint">{`≈ $${invoice.priceUsd.toFixed(2)} USD · for ${invoice.credits} credits`}</dd>
            </div>
            <div>
              <dt>{`Send to this ${label} address`}</dt>
              <dd className="buy-address">
                <code>{invoice.payAddress}</code>
                <button type="button" className="button-quiet" onClick={() => copy(invoice.payAddress)}>
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </dd>
            </div>
          </dl>
        </div>

        <p className="hint">
          Send only {label} to this address. Underpaid or late payments are refunded to the
          sending address.
        </p>
        <p className="hint" role="status">
          Waiting for payment confirmation…
        </p>

        <div className="buy-actions">
          <button type="button" className="button-quiet" onClick={() => setStage({ name: 'select' })}>
            Cancel
          </button>
          <span className="hint">Powered by NOWPayments</span>
        </div>
      </div>
    )
  }

  return (
    <div className="buy-card">
      <div className="buy-group">
        <span className="field-label">Choose an amount</span>
        <div className="chips">
          {QUICK_AMOUNTS.map((amount) => (
            <button
              key={amount}
              type="button"
              className="chip"
              aria-current={credits === amount}
              onClick={() => setCredits(amount)}
            >
              {`${amount} credits`}
            </button>
          ))}
        </div>
      </div>

      <div className="buy-group">
        <label className="field-label" htmlFor="buy-amount">
          Or enter a custom amount
        </label>
        <input
          id="buy-amount"
          className="buy-amount"
          type="number"
          min={MIN_PURCHASE_CREDITS}
          max={MAX_PURCHASE_CREDITS}
          step={1}
          value={credits}
          onChange={(event) => setCredits(Math.max(0, Math.floor(Number(event.target.value) || 0)))}
        />
      </div>

      <p className="buy-summary">
        <span>You’ll receive</span>
        <strong>{`${credits} credits`}</strong>
        <span className="hint">{`for $${credits.toFixed(2)} USD`}</span>
      </p>

      <div className="buy-group">
        <span className="field-label">Pay with</span>
        <div className="chips">
          {COINS.map((option) => (
            <button
              key={option.id}
              type="button"
              className="chip"
              aria-current={coin === option.id}
              onClick={() => setCoin(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {error ? <p className="form-error">{error}</p> : null}

      <div className="buy-actions">
        <button type="button" className="cta" disabled={pending || credits < MIN_PURCHASE_CREDITS} onClick={begin}>
          {pending ? 'Creating payment…' : 'Continue to payment'}
        </button>
      </div>

      <p className="hint">
        Crypto payments are processed by NOWPayments, which sees the amount and currency you
        choose — not your reading.
      </p>
    </div>
  )
}
