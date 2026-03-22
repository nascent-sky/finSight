import clsx from "clsx"

const Button = ({
  children,
  variant = "primary",
  size = "md",
  className,
  ...props
}) => {
  return (
    <button
      className={clsx(
        "rounded-lg font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2",
        
        // Variants
        variant === "primary" && "bg-primary text-white hover:bg-blue-700",
        variant === "secondary" &&
          "bg-gray-100 text-gray-900 hover:bg-gray-200",
        variant === "danger" &&
          "bg-red-600 text-white hover:bg-red-700",

        // Sizes
        size === "sm" && "px-3 py-1.5 text-sm",
        size === "md" && "px-4 py-2 text-sm",
        size === "lg" && "px-5 py-3 text-base",

        className
      )}
      {...props}
    >
      {children}
    </button>
  )
}

export default Button
