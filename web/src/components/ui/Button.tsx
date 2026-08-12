import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from 'react';

import { buttonSurface, type ButtonSize, type ButtonTone } from './button-surface';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly tone?: ButtonTone;
  readonly size?: ButtonSize;
};

export function Button({
  tone = 'quiet',
  size = 'md',
  type = 'button',
  className = '',
  ...rest
}: ButtonProps) {
  return <button type={type} className={buttonSurface(tone, size, className)} {...rest} />;
}

type ButtonLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  readonly tone?: ButtonTone;
  readonly size?: ButtonSize;
};

export function ButtonLink({
  tone = 'quiet',
  size = 'md',
  className = '',
  ...rest
}: ButtonLinkProps) {
  return <a className={buttonSurface(tone, size, className)} {...rest} />;
}
