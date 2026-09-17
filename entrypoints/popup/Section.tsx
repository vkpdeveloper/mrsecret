import type { ReactNode } from 'react';

export function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="section">
      {title && <h3 className="section-title">{title}</h3>}
      {children}
    </section>
  );
}
