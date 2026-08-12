import React from 'react'

export const metadata = { title: 'About' }

export default function AboutPage() {
  return (
    <main className="page">
      <section className="hero">
        <h1>About NobleSee</h1>
      </section>

      <div style={{ maxWidth: 'var(--measure)' }}>
        <p>
          A great many worthwhile books — traditional Chinese classics, histories, works on wisdom
          and on living well — exist online only as scanned page images. They are technically
          available and practically unreadable: you cannot change the type size, the text will not
          reflow, and on a phone or an e-reader you spend more effort panning than reading.
        </p>
        <p>
          NobleSee exists to close that gap. We find books that are hard to reach in
          e-reader-friendly form, digitise and OCR them, reconstruct and proofread the text, and
          publish careful EPUB and PDF editions. The aim is not to host files. The aim is to make
          these books genuinely pleasant to read.
        </p>

        <div className="section-head">
          <h2>How a book is made</h2>
        </div>
        <p>
          Scanned pages go through OCR, then normalisation, then AI-assisted correction — which
          suggests fixes for OCR errors, punctuation and paragraph breaks, but never silently
          rewrites the source. Every suggestion carries its original text and a reason, and a human
          approves it before it lands. The approved editable master is the source of truth, and
          every reader-facing format is generated from it.
        </p>

        <div className="section-head">
          <h2>Rights</h2>
        </div>
        <p>
          Not every book can be redistributed, and we do not pretend otherwise. Each title carries
          an explicit rights status, and only works that are in the public domain, licensed, or
          published with permission appear in the public library. Anything unreviewed stays closed.
        </p>

        <div className="section-head">
          <h2>Support</h2>
        </div>
        <p>
          Digitisation, proofreading and hosting cost money. Readers can support the work through
          donations or by buying an e-reader through our referral links. This is a preservation
          project that happens to need funding — not a shop with a library attached.
        </p>
      </div>
    </main>
  )
}
