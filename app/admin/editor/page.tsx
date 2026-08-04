"use client";

import { DigitalTwinEditor } from "@/features/admin/components/digital-twin-editor";

export default function CADEditorPage() {
  return (
    <div className="h-[calc(100vh-1rem)] w-full overflow-hidden">
      <DigitalTwinEditor initialTool="BUILDING" />
    </div>
  );
}
