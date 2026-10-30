"use client";

import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";

/** Opens the browser's print dialog (choose "Save as PDF" there to keep a copy). */
export function PrintButton() {
  return (
    <Button type="button" onClick={() => window.print()}>
      <Printer aria-hidden /> Print
    </Button>
  );
}
