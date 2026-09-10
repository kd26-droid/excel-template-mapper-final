import React from 'react';
import { cn } from '../../lib/utils';

const buttonVariants = {
  default: 'border border-transparent bg-slate-950 text-white shadow-sm hover:bg-slate-800 focus-visible:ring-slate-950',
  destructive: 'border border-transparent bg-red-600 text-white shadow-sm hover:bg-red-700 focus-visible:ring-red-600',
  outline: 'border border-slate-300 bg-white text-slate-900 shadow-sm hover:bg-slate-50 focus-visible:ring-slate-400',
  outlined: 'border border-slate-300 bg-white text-slate-900 shadow-sm hover:bg-slate-50 focus-visible:ring-slate-400',
  secondary: 'border border-transparent bg-slate-100 text-slate-900 shadow-sm hover:bg-slate-200 focus-visible:ring-slate-400',
  ghost: 'border border-transparent bg-transparent text-slate-700 hover:bg-slate-100 focus-visible:ring-slate-400',
};

const buttonSizes = {
  default: 'h-9 px-4 py-2 text-sm',
  sm: 'h-8 px-3 text-xs',
  lg: 'h-10 px-5 text-sm',
  icon: 'h-9 w-9 p-0',
};

export const Button = React.forwardRef(({
  className,
  variant = 'default',
  size = 'default',
  type = 'button',
  ...props
}, ref) => (
  <button
    ref={ref}
    type={type}
    className={cn(
      'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md font-semibold transition-colors',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
      'disabled:pointer-events-none disabled:opacity-50',
      buttonVariants[variant] || buttonVariants.default,
      buttonSizes[size] || buttonSizes.default,
      className
    )}
    {...props}
  />
));

Button.displayName = 'Button';
