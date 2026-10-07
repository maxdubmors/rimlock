// Common label set both engines are mapped onto.
export type Label = "username" | "current-password" | "new-password" | "signup-username" | "otp";
export type Detection = {
  engine: "bitwarden" | "proton";
  ms: number;
  fields: { id: string | null; label: Label }[];
};
