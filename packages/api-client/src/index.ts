export * from './types'

// Brief 105 — variant + custom facets
// Brief 106 extends with join-form-config overrides (same resource file).
export * as variant from './resources/variant'
export type {
  VerticalSlug,
  VariantTerminology,
  VariantModules,
  JoinFormSection,
  VariantConfig,
  JoinFormSectionOverride,
  JoinFormConfigPayload,
  JoinFormConfigErrorCode,
} from './resources/variant'
export {
  CLUB_DEFAULT_TERMINOLOGY,
  CLUB_DEFAULT_MODULES,
  CLUB_DEFAULT_JOIN_FORM_SECTIONS,
  LEGACY_JOIN_FORM_SECTION_KEYS,
  filterLegacyJoinFormSections,
} from './resources/variant'
export * as customFacets from './resources/customFacets'
export type {
  FacetInputType,
  FacetOption,
  CustomFacet,
  FacetValueInput,
  FacetValuesPayload,
  FacetAvailability,
  CreateFacetInput,
  UpdateFacetInput,
  ReorderFacetsInput,
  FacetErrorCode,
} from './resources/customFacets'

export * as members from './resources/members'
export type {
  MemberStatus,
  MemberType,
  MemberSource,
  MemberRole,
  MembershipCadence,
  MembershipTone,
  MembershipStatus,
  PaymentStatus,
  RosterMember,
  RosterMembership,
  RosterCounts,
  RosterPagination,
  RosterFilters,
  RosterResponse,
  PendingInvite,
  ListRosterParams,
  MembershipTypeFilter,
  MembershipSlugFilter,
  AddMemberInput,
  AddMemberResult,
  AddMemberResolution,
  AddMemberErrorCode,
  RemoveMemberResult,
  PaymentMethod,
  RecordPaymentInput,
  RecordPaymentResult,
  MembershipSnapshot,
  DeletePaymentResult,
  PaymentErrorCode,
  MemberPaymentRow,
  MemberPaymentsTotals,
  MemberPaymentsOutstanding,
  MemberPaymentsResponse,
  ListMemberPaymentsParams,
  MembersSummary,
  SummaryTopTier,
  MembershipTierListItem,
  MembershipSettings,
  MembershipTiersResponse,
  CreateTierInput,
  UpdateTierInput,
  MembershipTierErrorCode,
  PositionGroup,
  PreferredPosition,
  PlayingLevel,
  PublicMember,
  PublicMembersResponse,
  PublicListMembersParams,
  PublicPlayerProfile,
  UpdateMemberPatch,
  UpdateMemberResponse,
  UpdateMemberErrorCode,
  PublicMemberMatch,
} from './resources/members'
export * as events from './resources/events'
export type {
  EventCreateInput,
  EventUpdateInput,
  ListEventsParams,
  PublicListEventsParams,
  PublicEventsResponse,
} from './resources/events'
export type {
  EventType,
  BowlsFormat,
  Event,
  PublicEvent,
  PublicCalendarTournament,
  CalendarSource,
  EventRsvpPreview,
} from './types'
export * as honourBoard from './resources/honour-board'
export type {
  HonourCategory,
  HonourCategoryCreateInput,
  HonourCategoryUpdateInput,
  HonourEntry,
  HonourEntryCreateInput,
  HonourEntryUpdateInput,
  EntryPlayer,
  EntryPlayerInput,
  HonourFormat,
  PublicHonourCategory,
  PublicHonourEntry,
  PublicHonourEntriesResponse,
  PublicHonourEntriesParams,
  PlayerHonourEntry,
  PlayerHonourClub,
  PlayerHonourResponse,
} from './resources/honour-board'
export * as campaigns from './resources/campaigns'
export type {
  CampaignStatus,
  CampaignSort,
  CampaignMetricsWindow,
  CampaignAuthor,
  CampaignMetrics,
  CampaignRow,
  CampaignsCountsByStatus,
  CampaignsListResponse,
  CampaignsMetricsAggregate,
  CampaignsMetricsDeltas,
  CampaignsMetricsResponse,
  ListCampaignsParams,
  MetricsParams,
  CampaignRecipient,
  CampaignAnalytics,
  CampaignLink,
  CampaignDetail,
  ResendUnopenedResult,
  ArchiveResult,
  ResendUnopenedInput,
} from './resources/campaigns'
export * as communications from './resources/communications'
export type {
  CommunicationChannel,
  NoteType,
  EmailStatus,
  CommunicationStatus,
  MemberCommunication,
  MemberCommunicationsCounts,
  MemberCommunicationsResponse,
  LogNoteInput,
  PatchCommunicationInput,
  BatchSender,
  BatchRecipient,
  BatchCounts,
  BatchDetail,
  GetBatchParams,
  CommunicationDirection,
  ThreadMessage,
  ThreadResponse,
  ReplyInput,
  ReplyResult,
  ReplyErrorCode,
} from './resources/communications'
export * as clubs from './resources/clubs'
export type {
  BrandAssetsPatch,
  BrandAssetsResponse,
  ImageStyle,
  ChangeSubdomainErrorCode,
  ChangeSubdomainResult,
  ChangeEmailHandleErrorCode,
  ChangeEmailHandleResult,
  EmailHandleCheckResult,
} from './resources/clubs'
export * as directory from './resources/directory'
export type { DirectoryClub, ClubSearchParams, ClubSearchResult } from './resources/directory'
export * as auth from './resources/auth'
export { AuthError } from './resources/auth'
export type {
  AuthUser,
  LoginResponse,
  RegisterInput,
  Role,
  UserClub,
  UpdateMeInput,
  EmailChangeRequestResult,
  PasswordChangeInput,
  PasswordChangeResult,
  OrgType,
  PlanKey,
  SignupInput,
  SignupResult,
  SignupErrorCode,
} from './resources/auth'
export * as billing from './resources/billing'
export type {
  PlanState,
  PlanSource,
  SubscriptionStatus,
  CheckoutInput as BillingCheckoutInput,
  CheckoutResult as BillingCheckoutResult,
  PortalInput as BillingPortalInput,
  PortalResult as BillingPortalResult,
} from './resources/billing'
// Brief 123 — platform admin portal. Phase 1 (read) + Phase 2
// (actions + audit + users) live.
export * as admin from './resources/admin'
export type {
  // Phase 1 — read
  AdminWindow,
  AdminAccountPlan,
  AdminAccountSubscriptionStatus,
  AdminAccountSort,
  AdminTimelineKind,
  AdminAccountRow,
  AdminTimelineEvent,
  AdminAccountDetail,
  AdminAccountsList,
  AdminMetricsOverview,
  AdminMetricsBilling,
  ListAccountsParams as AdminListAccountsParams,
  // Phase 2 — actions
  AdminImpersonateInput,
  AdminImpersonateResult,
  AdminPlanOverrideInput,
  AdminPlanOverrideResult,
  AdminSuspendInput,
  AdminSuspendResult,
  AdminUnsuspendInput,
  // Phase 2 — audit log
  AdminAuditAction,
  AdminAuditActor,
  AdminAuditTargetClub,
  AdminAuditTargetUser,
  AdminAuditEntry,
  AdminAuditList,
  ListAuditParams as AdminListAuditParams,
  // Phase 2 — platform users
  AdminUserClubMembership,
  AdminUser,
  AdminUsersList,
  ListUsersParams as AdminListUsersParams,
  UpdateUserInput as AdminUpdateUserInput,
  UpdatedUser as AdminUpdatedUser,
  // Phase 3 — transactions drilldown
  AdminTransactionKind,
  AdminTransactionStatus,
  AdminTransactionRef,
  AdminTransactionMember,
  AdminTransactionRow,
  AdminTransactionsList,
  ListTransactionsParams as AdminListTransactionsParams,
  // Phase 3 — communications
  AdminCommunicationBatch,
  AdminCommunicationsList,
  ListCommunicationsParams as AdminListCommunicationsParams,
  AdminHighBounceAccount,
  AdminMetricsCommunications,
} from './resources/admin'
export * as notifications from './resources/notifications'
export type {
  NotificationKind,
  EmailDigest,
  NotificationTarget,
  NotificationAction,
  NotificationActor,
  Notification,
  ListNotificationsParams,
  ListNotificationsResponse,
  NotificationKindPreferences,
  NotificationSettings,
  NotificationSettingsPatch,
  NotificationErrorCode,
} from './resources/notifications'
export * as bulkEmail from './resources/bulkEmail'
export type {
  BulkEmailInput,
  BulkEmailRecipients,
  BulkEmailRecipientsIds,
  BulkEmailRecipientsFilter,
  BulkEmailResult,
  BulkEmailFailedRecipient,
  BulkEmailErrorCode,
} from './resources/bulkEmail'
export * as emailTemplate from './resources/emailTemplate'
export type {
  EmailFlavor,
  EmailVariableCategory,
  EmailVariable,
  EmailTemplate,
  EmailTemplatePatch,
  EmailPreviewResult,
  EmailTestSendInput,
  EmailTestSendResult,
  EmailTemplateErrorCode,
  EmailFlavorRow,
  EmailFlavorPatch,
  EmailFlavorsResponse,
  EmailFlavorErrorCode,
} from './resources/emailTemplate'
export * as enquiries from './resources/enquiries'
export type {
  EnquiryStatus,
  EnquiryTopic,
  EnquiryArchiveReason,
  EnquiryRow,
  EnquiryReply,
  EnquiryNote,
  EnquiryDetail,
  EnquiriesListResponse,
  ListEnquiriesParams,
  CreateEnquiryInput,
  CreateEnquiryResult,
  ReplyEnquiryInput,
  ReplyEnquiryResult,
  ArchiveEnquiryInput,
  ArchiveEnquiryResult,
  UpdateEnquiryInput,
  MarkReadResult,
  EnquirySettings,
  EnquirySettingsPatch,
  EnquiryErrorCode,
} from './resources/enquiries'
export * as tournaments from './resources/tournaments'
export type {
  TournamentFormat,
  TournamentCategory,
  TournamentGenderScope,
  TournamentStatus,
  TournamentPaymentMethod,
  TournamentEntryUnit,
  EntryStatus,
  TournamentStats,
  EntryCaptain,
  TournamentRosterMember,
  TournamentEntry,
  Tournament,
  TournamentListItem,
  TournamentStatusCounts,
  OffsetPagination,
  TournamentsListResponse,
  EntriesListResponse,
  PublicTournamentClub,
  PublicTournamentCard,
  PublicTournamentDetail,
  PublicTournamentsListResponse,
  CreateTournamentInput,
  UpdateTournamentInput,
  UpdateEntryInput,
  EnterTournamentInput,
  EnterTournamentResult,
  EnterTournamentCheckoutResult,
  WithdrawEntryInput,
  ListTournamentsParams,
  ListEntriesParams,
  PublicSort,
  PublicListTournamentsParams,
  TournamentErrorCode,
  EntryTemplate,
  VisitorCreated,
} from './resources/tournaments'
export * as applications from './resources/applications'
export type {
  ApplicationStatus,
  RejectReason,
  Resolution,
  ResolvedResult,
  ApplicationRow,
  ApplicationDetail,
  ApplicationNote,
  ApplicationAddress,
  ApplicationBowls,
  ApplicationEmergencyContact,
  ApplicationConsent,
  ApplicationsListResponse,
  ListApplicationsParams,
  ApproveInput,
  ApproveResult,
  RejectInput,
  RejectResult,
  ApplicationErrorCode,
  CreateApplicationInput,
  CreateApplicationResult,
} from './resources/applications'
export * as claims from './resources/claims'
export type {
  ClaimStatus,
  Sport,
  RejectionCode,
  MyClaim,
  AdminClaim,
  SubmitClaimInput,
  SubmitClaimResponse,
  ApproveClaimResponse,
  RejectClaimResponse,
} from './resources/claims'
export * as seasons from './resources/seasons'
export type { Season, CreateSeasonInput } from './resources/seasons'
export * as memberImports from './resources/memberImports'
export type {
  ImportResolution,
  ImportErrorCode,
  NewUserStrategy,
  ConflictCandidate,
  PreviewRow,
  PreviewRowError,
  PreviewRowWarning,
  PreviewRowInput,
  PreviewInput,
  PreviewSummary,
  PreviewResult,
  CommitRowResult,
  CommitResult,
} from './resources/memberImports'
export * as clubOnboarding from './resources/clubOnboarding'
export type {
  WizardStepValue,
  WizardDayHours,
  WizardTier,
  WizardData,
  OnboardingState,
  OnboardingPatchPayload,
  OnboardingPatchResponse,
  OnboardingCompleteResponse,
  OnboardingValidationError,
  SubdomainCheckResult,
} from './resources/clubOnboarding'
export * as pages from './resources/pages'
export type {
  PageSlug,
  SystemPageSlug,
  Page,
  PageErrorCode,
  UpdatePageInput,
  UpdatePageResponse,
  Block as PageBlock,
  PageLayout,
  PageMeta,
  PageState,
  PatchResponse as PagePatchResponse,
  PublishResponse as PagePublishResponse,
} from './resources/pages'
export { RESERVED_PAGE_SLUGS, isValidPageSlug, slugifyTitle } from './resources/pages'
export * as media from './resources/media'
export type {
  MediaEntityType,
  MediaContentType,
  UploadUrlResponse,
  ConfirmedImage,
  RequestUploadParams,
  ConfirmParams,
} from './resources/media'
export * as blockImages from './resources/blockImages'
export * as blockVideos from './resources/blockVideos'
export type {
  BlockVideo,
  BlockVideoState,
  BlockVideoUploadUrl,
  BlockVideoErrorCode,
} from './resources/blockVideos'
export type {
  BlockImage,
  UploadUrlResponse as BlockImageUploadUrlResponse,
  ConfirmParams as BlockImageConfirmParams,
  PatchParams as BlockImagePatchParams,
  ReorderResponse as BlockImageReorderResponse,
  CopyFromResponse as BlockImageCopyFromResponse,
} from './resources/blockImages'
export * as blockPdfs from './resources/blockPdfs'
export type {
  BlockPdf,
  UploadUrlResponse as BlockPdfUploadUrlResponse,
  ConfirmParams as BlockPdfConfirmParams,
  PatchParams as BlockPdfPatchParams,
} from './resources/blockPdfs'
export * as fontPairs from './resources/fontPairs'
export type {
  FontPair,
  FontPairsResponse,
  UpdateFontPairResponse,
} from './resources/fontPairs'
export * as stylePresets from './resources/stylePresets'
export type {
  StylePresetsResponse,
  UpdateStylePresetResponse,
} from './resources/stylePresets'
export * as colorSchemes from './resources/colorSchemes'
export type {
  ColorSchemesResponse,
  UpdateColorSchemeResponse,
} from './resources/colorSchemes'
export type {
  ColorScheme,
  ColorSchemeTokens,
  ClubColorScheme,
} from './types'
export * as navigation from './resources/navigation'
export type {
  UpdateNavigationInput,
  UpdateNavigationResponse,
  HeaderDisplay,
} from './resources/navigation'
export * as footer from './resources/footer'
export type { FooterConfigRead } from './resources/footer'
export type {
  FooterConfig,
  FooterColumn,
  FooterContactOverride,
  FooterLink,
  FooterSocial,
  FooterSocialIcon,
} from './types'
export * as clubSettings from './resources/clubSettings'
export type {
  ClubSettings,
  SettingsIdentity,
  SettingsLocation,
  SettingsFacility,
  SettingsContact,
  SettingsHour,
  SettingsMembership,
  SettingsMembershipTier,
  SettingsBrand,
  SettingsNavigation,
  SettingsSEO,
  SettingsPublishing,
  SettingsPage,
} from './resources/clubSettings'
export * as venuePackages from './resources/venuePackages'
export type {
  VenuePackage,
  VenuePackageListItem,
  VenueSlot,
  VenueAddon,
  VenueSettings,
  CreateVenuePackageInput,
  UpdateVenuePackageInput,
  UpdateVenueSettingsInput,
  VenuePackagesListResponse,
  ListVenuePackagesParams,
  VenuePackageErrorCode,
  BelowCurrentCountConflict,
  BelowCurrentCountData,
  PublicVenuePackage,
  PublicVenueSlot,
  PublicVenueAddon,
  PublicVenueSettings,
  PublicVenuePackagesResponse,
} from './resources/venuePackages'

export * as venueBookings from './resources/venueBookings'
export type {
  VenueBooking,
  BookingStatus,
  VenuePaymentStatus,
  BookingSource,
  AddonLine,
  VenueBookingCounts,
  VenueBookingsListResponse,
  ListVenueBookingsParams,
  SubmitVenueBookingInput,
  VenueBookingDeleteResult,
  VenueBookingErrorCode,
  SlotUnavailableData,
  LeadTimeViolatedData,
  VenueBookingCheckoutResult,
  ClubNotPaymentReadyData,
  TakenSlot,
  VenueAvailabilityResult,
  VenueBookingStatus,
  VenueBookingPaymentStatus,
  PublicVenueBookingRead,
} from './resources/venueBookings'

export * as stripeConnect from './resources/stripeConnect'
export type {
  StripeAccountStatus,
  StripeConnectStartResponse,
  StripeStatus,
  StripeDisconnectResponse,
  StripeConnectErrorCode,
} from './resources/stripeConnect'

export * as tournamentSettings from './resources/tournamentSettings'
export type {
  TournamentSettings,
  UpdateTournamentSettingsInput,
  TournamentSettingsErrorCode,
} from './resources/tournamentSettings'

export * as teamAnnouncements from './resources/teamAnnouncements'
export type {
  TeamAnnouncement,
  TeamAnnouncementListItem,
  TeamAnnouncementMember,
  TeamAnnouncementStatus,
  TeamAnnouncementsListResponse,
  ListTeamAnnouncementsParams,
  CreateTeamAnnouncementInput,
  UpdateTeamAnnouncementInput,
  TeamAnnouncementErrorCode,
} from './resources/teamAnnouncements'

export * as tournamentResults from './resources/tournamentResults'
export type {
  TournamentResult,
  TournamentResultEntry,
  TournamentResultsResponse,
  TournamentResultInput,
  SubmitResultsInput,
  TournamentResultErrorCode,
} from './resources/tournamentResults'

export * as teamSelections from './resources/teamSelections'
export type {
  TeamSelection,
  TeamSelectionListItem,
  TeamSelectionsListResponse,
  TeamSelectionRink,
  TeamSelectionSlot,
  TeamSelectionMemberSnapshot,
  TeamSelectionStatus,
  TeamSelectionVenue,
  TeamSelectionPosition,
  FormatShape,
  ListTeamSelectionsParams,
  CreateTeamSelectionInput,
  UpdateFixtureInput,
  UpdateRosterInput,
  UpdateRosterRinkInput,
  UpdateRosterSlotInput,
  PublishInput,
  CancelInput,
  NotifySummary,
  PublishResult,
  TeamSelectionErrorCode,
} from './resources/teamSelections'

export * as invites from './resources/invites'
export type {
  InviteStatus,
  InviteRole,
  InviteInvitedBy,
  ClubInvite,
  CreateInviteInput,
  CreateInviteResult,
  CreateInviteErrorCode,
  RevokeInviteErrorCode,
  AcceptInviteInput,
  AcceptInviteResult,
  AcceptInviteErrorCode,
} from './resources/invites'

export * as permissions from './permissions'
export type {
  Permission,
  ProPermission,
  SectionKey,
  SectionDef,
  SettingsSectionDef,
  SectionToggleState,
  SectionToggleMap,
  PermissionPreset,
} from './permissions'
export {
  ALL_PERMISSIONS,
  HARD_CODED_PERMISSIONS,
  PRO_PERMISSIONS,
  SECTIONS,
  SECTION_PII_PERMISSION,
  SETTINGS_PERMISSIONS,
  PRESETS,
  isProPermission,
  toggleStateToPermissions,
  permissionsToToggleState,
  matchPreset,
} from './permissions'

export * as ai from './resources/ai'
export type {
  AiBrandContext,
  AiNearbyBlock,
  AiImageRef,
  AiIterationContext,
  GenerateBlockInput,
  GeneratedBlock,
  GenerateBlockErrorCode,
  GenerateBlockRateLimit,
} from './resources/ai'

export { SAM_BASE, CRM_BASE, MEDIA_BASE, BULK_EMAIL_BASE, VENUE_BASE } from './config'
export { ApiError, authedFetch, publicFetch, registerApiErrorObserver, setImpersonationToken, TOKEN_STORAGE_KEY } from './http'
