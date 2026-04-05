export type SimControlSnapshot = {
  paused: boolean;
  dt: number;
  defaultDt: number;
};

function parseControlFlag(value: string | null): boolean | null {
  if (value === '1' || value === 'true') {
    return true;
  }
  if (value === '0' || value === 'false') {
    return false;
  }
  return null;
}

function parsePositiveNumber(value: string | null): number | null {
  if (value === null || value.trim() === '') {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

export function parseSimControlMessage(message: string): SimControlSnapshot | null {
  const prefix = 'control:state?';
  if (!message.startsWith(prefix)) {
    return null;
  }

  const searchParams = new URLSearchParams(message.slice(prefix.length));
  const paused = parseControlFlag(searchParams.get('paused'));
  const dt = parsePositiveNumber(searchParams.get('dt'));
  const defaultDt = parsePositiveNumber(searchParams.get('defaultDt'));

  if (
    paused === null
    || dt === null
    || defaultDt === null
  ) {
    return null;
  }

  return {
    paused,
    dt,
    defaultDt
  };
}

export function formatSimControlDt(value: number): string {
  return Number.isFinite(value) ? String(value) : '';
}
