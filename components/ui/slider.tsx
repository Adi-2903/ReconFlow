import * as React from "react"
import { cn } from "@/lib/utils"

export interface SliderProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value?: number[];
  onValueChange?: (value: number[]) => void;
  max?: number;
  min?: number;
  step?: number;
}

const Slider = React.forwardRef<HTMLInputElement, SliderProps>(
  ({ className, min = 0, max = 100, step = 1, value, onValueChange, ...props }, ref) => {
    const val = value?.[0] ?? min;
    const percentage = ((val - min) / (max - min)) * 100;
    
    return (
      <div className={cn("relative flex w-full touch-none select-none items-center", className)}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={val}
          onChange={(e) => onValueChange?.([parseFloat(e.target.value)])}
          className="absolute w-full h-full opacity-0 cursor-pointer z-20"
          ref={ref}
          {...props}
        />
        <div className="relative h-2 w-full grow overflow-hidden rounded-full bg-slate-100 z-0">
          <div className="absolute h-full bg-slate-900" style={{ width: percentage + "%" }} />
        </div>
        <div 
          className="absolute h-5 w-5 rounded-full border-2 border-slate-900 bg-white ring-offset-white transition-colors z-10 pointer-events-none" 
          style={{ left: "calc(" + percentage + "% - 10px)" }} 
        />
      </div>
    )
  }
)
Slider.displayName = "Slider"

export { Slider }
