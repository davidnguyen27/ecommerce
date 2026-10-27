import { cva, type VariantProps } from 'class-variance-authority'

export { default as Badge } from './Badge.vue'

export const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 tracking-wide',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        destructive: 'border-transparent bg-destructive/10 text-destructive border border-destructive/20',
        outline: 'text-foreground border border-border',
        published: 'bg-[#ECFDF5] text-[#14532D] border border-[#A7F3D0]',
        draft: 'bg-[#FEFCE8] text-[#854D0E] border border-[#FDE047]',
        archived: 'bg-[#FDF2F8] text-[#831843] border border-[#FBCFE8]',
        role: 'bg-secondary text-[#343A46] border border-border uppercase text-[10px]',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

export type BadgeVariants = VariantProps<typeof badgeVariants>
