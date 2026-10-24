/* demo.js — a clearly labelled, fictional sample meeting. All people, projects and deadlines are invented.
 * Dates inside the transcript are generated relative to "today" so the demo always shows a realistic mix of
 * overdue / due-soon work. */
(function (root) {
  'use strict';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function iso(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function plus(d, n) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 10, 0, 0); return x; }
  function short(d) { return MON[d.getMonth()] + ' ' + d.getDate(); }
  function long(d) { return ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][d.getMonth()] + ' ' + d.getDate(); }

  /** @param {Date} today */
  function buildDemoMeeting(today) {
    var held = plus(today, -5);          // the meeting happened five days ago
    var fixBy = plus(held, 2);           // explicit deadline -> already overdue today
    var announceBy = plus(today, 3);     // explicit deadline -> due soon
    var launch = plus(today, 23);
    var transcript = [
      "Priya: Good morning everyone. Today's agenda covers the Northwind Mobile App v2 launch readiness, the onboarding redesign, and the marketing plan. Let's start with the launch date.",
      "Marcus: Engineering is mostly on track. The login crash on Android 12 is the main issue and it is blocking the beta release. It affects about one in twenty sign-ins on older devices.",
      "Priya: Understood. Can you fix it quickly?",
      "Marcus: I'll fix the login crash by " + short(fixBy) + ". That is urgent for the beta.",
      "Sam: Once the fix is in, QA needs the full regression suite. I'll run the regression tests sometime next week.",
      "Priya: Okay. On the launch date, we decided to keep " + long(launch) + " for the public release.",
      "Priya: We agreed to ship the beta to internal testers first before opening the TestFlight group to customers.",
      "Elena: Moving to onboarding. Users are dropping off at the permissions screen. I think we could try a shorter tutorial, maybe three steps instead of five, but I'm not sure it helps yet.",
      "Priya: Let's not commit to that yet. Elena, can you share the final onboarding mockups by Friday?",
      "Elena: Sure, I'll send them over by Friday.",
      "Jordan: For marketing, the press kit is waiting on final screenshots, and we haven't decided who will brief the support team on the new onboarding flow.",
      "Priya: Good point. Someone needs to confirm the payment provider contract renewal date before the launch.",
      "Jordan: I'll draft the launch announcement and share it for review by " + short(announceBy) + ".",
      "Priya: Great. We decided to use the existing Northwind brand colors for the announcement rather than commissioning a new palette.",
      "Priya: Anything else? Okay, let's wrap up. Thanks, everyone."
    ].join('\n');
    return {
      title: 'Product Sync: Northwind Mobile App v2 (SAMPLE)',
      startsAt: iso(held) + 'T10:00',
      participants: ['Priya Nair', 'Marcus Lee', 'Elena Rossi', 'Sam Okafor', 'Jordan Blake'],
      project: 'Northwind Mobile App v2',
      transcript: transcript,
      isDemo: true
    };
  }
  root.DemoData = { buildDemoMeeting: buildDemoMeeting };
  if (typeof module === 'object' && module.exports) module.exports = root.DemoData;
})(typeof self !== 'undefined' ? self : this);
