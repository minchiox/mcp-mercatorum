// Everything that is specific to the Mercatorum / Multiversity platform lives here,
// so a change on their side is a one-file fix.

/** Chamilo (PHP) portal: lists every enrolled course. */
export const PORTAL_URL = 'https://lms-courses.mercatorum.multiversity.click/user_portal.php';
/** Vue SPA: loading its home renews the JWT from the refresh-token cookie. */
export const SPA_HOME = 'https://lms.mercatorum.multiversity.click/';
/** Lesson player in the SPA: a link for the student to open in their own browser and watch. */
export const watchUrl = (course: string, lpId: number): string => `${SPA_HOME}videolezioni/${course}/${lpId}`;
/** REST API used by the SPA, authenticated with `Authorization: Bearer <mercatorum_token cookie>`. */
export const API_BASE = 'https://lms-api.prod.mercatorum.multiversity.click';
export const API_HOST = new URL(API_BASE).host;

export const TOKEN_COOKIE = 'mercatorum_token';
export const REFRESH_COOKIE = 'mercatorum_refresh_token';

/** Videos and PDF handouts are on CloudFront; subtitles (.vtt) on a sibling host with the same path. */
export const VIDEO_HOST = 'https://d9t931z8aeptt.cloudfront.net/';
export const VTT_HOST = 'https://video-mercatorum.multiversity.click/';

/** Hosts the tools may be pointed at. Suffix match on the hostname. */
export const ALLOWED_HOST_SUFFIXES = ['multiversity.click', 'unimercatorum.it', new URL(VIDEO_HOST).hostname];

/**
 * Endpoints that record attendance / progress. They are never called, and the browser is
 * prevented from calling them, so using this tool can never alter a student's attendance.
 * Observed: `POST /student/course/{code}/lesson/view/inizialize` fires as soon as a lesson opens.
 */
export const TRACKING_PATH_RE = /\/lesson\/view(\/|$)/i;

/**
 * Non-GET API calls that are pure reads or session maintenance, so the SPA keeps working.
 * Every other non-GET request to the API host is blocked.
 */
export const SAFE_WRITE_PATH_RE = /(\/auth\/|\/(refresh|login|logout)\b|token|\/getNotes$)/i;

export const API_PATHS = {
  coursesInProgress: '/student/video-lessons/getCourses/tocomplete',
  lessons: (course: string) => `/student/course/${course}/video-lessons/0`,
  lessonItems: (course: string, lpId: number) =>
    `/student/course/${course}/video-lesson/${lpId}/paragraphs/${lpId}`,
} as const;

/** Course codes are uppercase alphanumerics (e.g. 0662509SECSS01); validated before building URLs. */
export const COURSE_CODE_RE = /^[A-Z0-9]{3,32}$/;
