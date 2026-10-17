import type { ReactNode } from 'react';

export function PhoneFrame({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`phone ${className}`.trim()}>
      <div className="phone-screen">{children}</div>
    </div>
  );
}
