# Feature & Requirements Specification: Mobile Weight Lifting Tracker (V1)

This document serves as the structural blueprint and feature checklist for the mobile-friendly weight lifting application. It outlines the core database requirements, rotation logic, and mobile-optimized user experience patterns required for development.

---

## 1. Global Exercise Library & Database Schema

To prevent repetitive data entry when rebuilding or shifting routines, the application must decouple exercises from specific routines using a global master database.

### 1.1 Core Exercise Attributes
Each exercise in the master library requires the following properties:
*   **ID:** Unique identifier (UUID).
*   **Name:** String (e.g., "Dumbbell Bench Press", "Curls", "Push Ups").
*   **Bodyweight-Only Toggle:** Boolean flag.
*   **Default Rest Timer:** Integer (duration in seconds, defaulting to 90 seconds if unconfigured).

### 1.2 Muscle Group Volume Mapping (Fractional Vectors)
Every exercise must map to a target muscle group matrix using a fractional rating system (`1.0` or `0.5`). This data calculates active and predicted training volume.
*   **Supported Muscle Groups:** Chest, Back, Shoulders, Legs, Biceps, Triceps.
*   *Example Configurations:*
    *   `Dumbbell Bench Press`: Chest = 1.0, Triceps = 0.5 (All others = 0)
    *   `Rows`: Back = 1.0, Biceps = 0.5 (All others = 0)
    *   `Curls`: Biceps = 1.0 (All others = 0)

### 1.3 Bodyweight-Only Mode Interface Logic
When the `Bodyweight-Only` toggle is active for an exercise, the UI must dynamically alter its data-logging layout:
*   **Strip Weight Inputs:** Completely hide or disable the "Weight" text input fields across active workout screens.
*   **Reps-Only Tracking:** Display only a "Reps" tracking field per set.
*   **Target Mutation:** Convert the "Next Target Weight" predictive field into a "Next Target Reps" field.

---

## 2. Routine Builder ("Sandbox Mode")

The Routine Builder is a pre-workout configuration module where users model their multi-week training programs before launching them.

### 2.1 Custom Program Dimensions
Users must be able to visually customize the bounds of their training matrix:
*   **Days in Split:** Configure between `3` to `7` discrete workout days (e.g., Day 1 through Day 4).
*   **Cycles per Routine:** Set the depth of the routine block by choosing the total number of rotation cycles (historically labeled as "Logs", e.g., 1 to 4 cycles) before the routine reaches auto-completion.

### 2.2 Predicted Impact Dashboard (Live Volumetric Feedback)
As the user adds exercises, assigns them to specific days, and configures target sets:
*   The application must calculate a real-time predictive volume summation metric for each muscle group using the formula:
    $$ ext{Total Muscle Volume} = \sum ( ext{Planned Sets} imes ext{Muscle Fractional Rating})$$
*   The UI must present this balance data inline (via progress bars, rings, or a clear numerical dashboard) to let the user review training splits and adjust exercise choices before saving the routine.

---

## 3. Cycle Rotation Engine

The application does not follow a strict calendar-week schedule. Instead, it relies on an algorithmic queue to cycle through workouts sequentially.

### 3.1 Horizontal Progression Logic
Progress advances through all planned Days within Cycle $X$ before looping back to Day 1 to initiate Cycle $X+1$.
*   *Example 4-Day / 4-Cycle Routine Flow:*
    $$ ext{Day 1 (Cycle 1)}
ightarrow ext{Day 2 (Cycle 1)}
ightarrow ext{Day 3 (Cycle 1)}
ightarrow ext{Day 4 (Cycle 1)}
ightarrow ext{Day 1 (Cycle 2)}
ightarrow \dots$$

### 3.2 Session State Adherence (V1 Restraints)
To ensure structural integrity in the first release:
*   Workout structures are **locked** once the routine is activated.
*   Users cannot dynamically inject unplanned exercises or modify the planned number of sets while actively tracking on the gym floor. (Reserved for future dynamic swapping enhancements).

### 3.3 Pause & Resume (Incomplete Sessions)
If a user exits the application mid-workout:
*   The app must flag the session as "In-Progress" and securely save partial set data.
*   Upon reopening the app, the interface must force-resume the uncompleted day.
*   The rotation queue is blocked from advancing to the next sequential day until **every** planned exercise for the current day contains completed log data.

---

## 4. Gym Floor Logger (Mobile-First UX)

The active tracking interface is highly optimized for fast, single-handed mobile usage to mitigate weight-room friction.

### 4.1 Volumetric Progress Dashboard
*   The active screen features a persistent, responsive micro-dashboard that tracks logged muscle volume accomplished during the current session against the overall routine targets.

### 4.2 Set-by-Set Data Cloning
*   To minimize text field interactions, entering data into the `Weight` and `Reps` inputs for **Set 1** must automatically clone those identical values down into all subsequent rows (Set 2, Set 3, Set 4).
*   If the user hits matching metrics across all sets, they tap save once. If performance drops (e.g., dropping from 12 reps to 10 reps on Set 3), the user only taps and overwrites that specific field.

### 4.3 Inline Auto-Timer
*   The moment a user marks a specific set row as completed, the UI must immediately spin up an inline overlay countdown timer.
*   The duration pulls directly from that exercise's configured default rest timer (e.g., 90 seconds) to ensure optimal recovery periods without forcing the user to switch apps.

---

## 5. Progressive Overload & "Fresh Memory" Targeting

This mechanism captures intuitive training targets immediately after a heavy lift while the physiological exertion data is fresh in the user's mind.

### 5.1 "Next Target" Field UI
*   An always-visible context input labeled `Next Target Weight` (or `Next Target Reps` for bodyweight selections) must reside directly underneath the active logging rows for every exercise block.

### 5.2 Smart Pre-Filling Behavior
*   The app must automatically pre-fill this field with the maximum weight/rep metrics successfully logged in the current active sets.
*   The value acts as an implicit baseline assuming the user will at least match their current threshold during the next rotation cycle.

### 5.3 Intuitive Overwrite & Promotion
*   While resting between sets or wrapping up an exercise, the user can easily tap this pre-filled value to increase it (e.g., adjusting a pre-filled 185 lbs to 190 lbs for the next cycle).
*   When that specific workout day rolls around in the next cycle, this custom target value is retrieved and surfaced prominently as the "Recommended Target Baseline".

---

## 6. Routine Lifecycle: Archiving & Duplication

Handles the state transition when the definitive matrix cell is completed (e.g., Day 4, Cycle 4 is checked off).

### 6.1 Historical Archiving
*   The active routine state transitions to `Completed`.
*   All deep analytical records, set entries, and time-stamps are compiled and pushed to a persistent historical repository.

### 6.2 Clone & Repeat Engine (Baseline Promotion)
*   Upon closing out a routine, the application must offer a primary action to **"Clone & Repeat"** the program.
*   Executing this action duplicates the exact structural layout (same Day sequence, matching exercise selections, and identical set counts).
*   **The Baseline Promotion Handshake:** The system instantiates Cycle 1 of the *new* routine by consuming the `Next Target Weights/Reps` saved during the final cycles of the *previous* routine, promoting them to the new starting benchmarks.
