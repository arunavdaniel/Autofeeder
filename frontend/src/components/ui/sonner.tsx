import { type ComponentProps } from "react";
import { Toaster as Sonner } from "sonner";
import { useTheme } from "@/components/theme-provider";

export function Toaster(props: ComponentProps<typeof Sonner>) {
  const { theme } = useTheme();
  return (
    <Sonner
      theme={theme}
      position="bottom-right"
      richColors
      className="toaster group"
      {...props}
    />
  );
}
