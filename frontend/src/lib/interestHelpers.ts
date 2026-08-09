export type InterestCategory = {
  id: string;
  slug: string;
  label: string;
  exclude_genders: string[];
  include_genders: string[] | null;
  sort_order: number;
};

export type AudienceGenderFilter = "" | "female" | "male" | "exclude_male" | "exclude_female";

export type AudienceFilterInput = {
  organizationId?: string;
  channelId?: string;
  genderFilter?: AudienceGenderFilter;
  interestIds?: string[];
  lifecycleStage?: string;
  marketingOptInOnly?: boolean;
};

export function slugifyInterestLabel(label: string): string {
  const ascii = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (ascii) return ascii.slice(0, 80);
  return `interest-${Date.now().toString(36)}`;
}

export function buildAudienceResolvePayload(input: AudienceFilterInput) {
  const payload: Record<string, unknown> = {
    marketing_opt_in_only: input.marketingOptInOnly ?? true,
    limit: 500
  };
  if (input.organizationId) payload.organization_id = input.organizationId;
  if (input.channelId) payload.channel_id = input.channelId;
  if (input.lifecycleStage) payload.lifecycle_stage = input.lifecycleStage;
  if (input.interestIds?.length) payload.interest_ids = input.interestIds;

  switch (input.genderFilter) {
    case "female":
      payload.gender = "female";
      break;
    case "male":
      payload.gender = "male";
      break;
    case "exclude_male":
      payload.exclude_genders = ["male"];
      break;
    case "exclude_female":
      payload.exclude_genders = ["female"];
      break;
    default:
      break;
  }
  return payload;
}

export const AUDIENCE_GENDER_OPTIONS: Array<{ value: AudienceGenderFilter; label: string }> = [
  { value: "", label: "كل الأجناس" },
  { value: "female", label: "نساء فقط" },
  { value: "male", label: "رجال فقط" },
  { value: "exclude_male", label: "استبعاد الرجال" },
  { value: "exclude_female", label: "استبعاد النساء" }
];
