import { cva, type VariantProps } from 'class-variance-authority'

export { default as Alert } from './Alert.vue'
export { default as AlertTitle } from './AlertTitle.vue'
export { default as AlertDescription } from './AlertDescription.vue'

export const alertVariants = cva(
  'relative w-full rounded-md border p-3.5 text-xs [&>svg~*]:pl-7 [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-3.5 [&>svg]:top-3.5 [&>svg]:text-foreground',
  {
    variants: {
      variant: {
        default: 'bg-background text-foreground border-border',
        destructive: 'border-destructive/30 text-destructive bg-destructive/10 [&>svg]:text-destructive',
        warning: 'border-[#FDE047] text-[#854D0E] bg-[#FEFCE8] [&>svg]:text-[#854D0E]',
        success: 'border-[#A7F3D0] text-[#14532D] bg-[#ECFDF5] [&>svg]:text-[#14532D]',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

export type AlertVariants = VariantProps<typeof alertVariants>
