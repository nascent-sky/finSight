import { ShieldCheck } from 'lucide-react'

const BrandedHeader = () => {
  return (
    <div className="flex items-center gap-3">
      {/* Logo Icon */}
      <div className="relative">
        <div className="w-10 h-10 rounded-full bg-linear-to-br from-cyan-400 to-blue-600 flex items-center justify-center shadow-lg">
          <ShieldCheck size={24} className="text-white" strokeWidth={1.5} />
        </div>
        <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-emerald-400 animate-pulse" />
      </div>

      {/* Brand Name */}
      <div className="flex flex-col">
        <span className="text-xl font-black bg-linear-to-r from-cyan-500 via-blue-600 to-indigo-600 bg-clip-text text-transparent leading-none">
          FinSight
        </span>
        <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">
          Smart Financial Insights
        </span>
      </div>
    </div>
  )
}

export default BrandedHeader
