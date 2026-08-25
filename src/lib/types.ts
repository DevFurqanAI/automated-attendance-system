/** Shared domain types, mirroring the Postgres schema in supabase/migrations. */

export type Role = 'employee' | 'hr_admin' | 'super_admin';
export type Method = 'qr_gps' | 'remote_request';
export type Status = 'approved' | 'pending' | 'flagged' | 'declined';
export type FlagReason =
  | 'mock_location_detected'
  | 'impossible_travel'
  | 'coordinate_jitter'
  | 'out_of_range'
  | 'branch_mismatch'
  | 'force_closed'
  | 'remote_checkout_requested';

export interface Branch {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
  qr_version: number;
  created_at: string;
  /** 0=Sunday..6=Saturday. This branch's default weekly off days. */
  weekly_off_days: number[];
}

/** Only ever loaded server-side — carries the QR signing secret. */
export interface BranchWithSecret extends Branch {
  qr_secret: string;
}

export interface Employee {
  id: string;
  full_name: string;
  email: string;
  role: Role;
  default_branch_id: string | null;
  /** Overrides the branch's weekly_off_days when set. Null = inherit. */
  weekly_off_days: number[] | null;
  active: boolean;
  created_at: string;
}

export interface Attendance {
  id: string;
  employee_id: string;
  branch_id: string | null;
  check_in_time: string | null;
  check_out_time: string | null;
  submitted_at: string;
  claimed_check_in_time: string | null;
  claimed_check_out_time: string | null;
  check_in_lat: number | null;
  check_in_lng: number | null;
  check_in_accuracy_meters: number | null;
  check_out_lat: number | null;
  check_out_lng: number | null;
  /** Branch that closed the shift. Differs from branch_id on a split shift. */
  check_out_branch_id: string | null;
  method: Method;
  status: Status;
  flag_reason: FlagReason | null;
  remote_reason: string | null;
  selfie_url: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

/** Attendance joined with the names needed to render a row. */
export interface AttendanceRow extends Attendance {
  employees: Pick<Employee, 'id' | 'full_name' | 'email'> | null;
  branches: Pick<Branch, 'id' | 'name'> | null;
  /** Branch that closed the shift, when it differs from `branches`. */
  checkout_branch: Pick<Branch, 'id' | 'name'> | null;
}

export const FLAG_REASON_LABELS: Record<FlagReason, string> = {
  mock_location_detected: 'Mock location detected',
  impossible_travel: 'Impossible travel',
  coordinate_jitter: 'Suspicious coordinate repetition',
  out_of_range: 'Outside branch geofence',
  branch_mismatch: 'Checked out at a different branch',
  force_closed: 'Closed by HR (no check-out scan)',
  remote_checkout_requested: 'Employee requested a remote checkout',
};

export const REMOTE_REASONS = [
  'Client visit',
  'Offsite meeting',
  'Working from home',
  'Field work',
  'Other',
] as const;

/** How far back a remote request may claim work, per spec §7.4. */
export const REMOTE_CLAIM_MAX_AGE_DAYS = 2;

export type CalendarDayKind = 'holiday' | 'mandatory_workday';

export interface BranchCalendarDay {
  id: string;
  branch_id: string;
  date: string;
  kind: CalendarDayKind;
  label: string | null;
  created_at: string;
}

export const CALENDAR_DAY_KIND_LABELS: Record<CalendarDayKind, string> = {
  holiday: 'Holiday',
  mandatory_workday: 'Mandatory workday',
};

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export type LeaveStatus = 'pending' | 'approved' | 'declined';

export interface LeaveRequest {
  id: string;
  employee_id: string;
  from_date: string;
  to_date: string;
  reason: string;
  status: LeaveStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface LeaveRequestRow extends LeaveRequest {
  employees: Pick<Employee, 'id' | 'full_name' | 'email'> | null;
}

export interface Absence {
  id: string;
  employee_id: string;
  branch_id: string | null;
  date: string;
  created_at: string;
}
