const tailwind600: Record<string, string> = {
  amber: '#d97706',
  blue: '#2563eb',
  cyan: '#0ea5e9',
  emerald: '#059669',
  fuchsia: '#c026d3',
  green: '#16a34a',
  indigo: '#4f46e5',
  lightBlue: '#0284c7',
  lime: '#65a30d',
  orange: '#ea580c',
  pink: '#db2777',
  purple: '#7c3aed',
  red: '#dc2626',
  rose: '#e11d48',
  sky: '#0284c7',
  teal: '#0d9488',
  violet: '#7c3aed',
  yellow: '#ca8a04',
}

const isHexColor = (value: string) => /^#(?:[0-9a-fA-F]{3}){1,2}$/.test(value)

export const resolveBrandColor = (value?: string | null) => {
  if (!value) {
    return tailwind600.blue
  }
  const trimmed = value.trim()
  if (isHexColor(trimmed)) {
    return trimmed
  }
  return tailwind600[trimmed] ?? tailwind600.blue
}
