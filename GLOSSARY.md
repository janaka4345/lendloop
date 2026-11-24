# LendLoop

A neighborhood tool-lending board where neighbors list tools for lending, request to borrow from each other, and receive automated notifications and overdue reminders.

## Language

### Actors and Roles

**User**:
A signed-in neighbor with a LendLoop account, holding either the `user` or `admin` platform role.
_Avoid_: Member, Account, Profile

**Lender**:
The `User` who created and owns a `Listing`.
_Avoid_: Owner, Host

**Borrower**:
The `User` who requests or borrows a `Listing` through a `Loan`.
_Avoid_: Requester, Renter

**Admin**:
A `User` with the `admin` platform role who can moderate any `Listing`, view all `Loan`s, and grant or revoke `Trusted Lender` status.
_Avoid_: Moderator, Superuser

**Trusted Lender**:
An `Admin`-granted trust designation displayed on a `User`'s listings and loans; it does not alter lending rules.
_Avoid_: Verified Lender, Pro Lender

### Core Entities

**Listing**:
A tool offered by a `Lender` on LendLoop, described by its name, `Category`, `Condition`, short description, and optional photos.
_Avoid_: Tool, Item, Post

**Loan**:
A single request-to-return lifecycle record between a `Borrower` and a `Lender` for a `Listing` over a requested date range.
_Avoid_: BorrowRequest, Reservation, Booking

**Category**:
A closed classification for a `Listing` used for browsing and filtering (`power_tools`, `garden`, `kitchen`, `camping`, `hand_tools`, `automotive`, `cleaning`, `other`).
_Avoid_: Tag, Type

**Condition**:
A closed assessment of a `Listing`'s physical state (`new`, `like_new`, `good`, `fair`).
_Avoid_: Quality, Grade

### Lifecycle and Observability

**Availability**:
Whether a `Listing` can be used today: `Available` (no unreturned `approved` `Loan` covering today or overdue) or `Currently Borrowed` (an unreturned `approved` `Loan` covers today or is overdue).
_Avoid_: In Stock, Free, Booked

**Overdue**:
A derived state of an `approved` `Loan` whose end date has passed without being marked `returned`.
_Avoid_: Late, Expired, Delinquent

**Automation Activity**:
A record on a `Loan` capturing an automated notification or overdue reminder, starting in a transient `pending` state while in flight and settling to an immutable delivery outcome (`sent` or `failed`).
_Avoid_: Webhook Log, Notification History

**Audit Log**:
An immutable security and governance record of sensitive actions, including role changes, `Trusted Lender` toggles, `Listing` removals, and `Loan` state transitions.
_Avoid_: Activity Feed, Event Log
