import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from '../icons.js';

export interface Crumb {
  label: string;
  to?: string;
}

export function PageHeader({
  title,
  subtitle,
  action,
  breadcrumbs,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  breadcrumbs?: Crumb[];
}) {
  return (
    <div className="mb-5">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-2 flex items-center gap-1 text-xs text-content-faint">
          {breadcrumbs.map((c, i) => (
            <span key={c.label} className="flex items-center gap-1">
              {i > 0 && <ChevronRight aria-hidden className="h-3 w-3" />}
              {c.to ? (
                <Link to={c.to} className="transition-colors duration-fast hover:text-content">
                  {c.label}
                </Link>
              ) : (
                <span>{c.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}

      {/* Stacks on phones so a long title and its action never collide. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-content">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-content-muted">{subtitle}</p>}
        </div>
        {action}
      </div>
    </div>
  );
}
