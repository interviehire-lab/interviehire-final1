

// ==========================================
// STATE STORE
// ==========================================
import type { Job, Candidate, TeamMember } from './types';

const AppState = {
  activeTab: 'jobs',
  activeSubtab: '',
  activeJobId: null,
  activeReportCandidateId: null,
  jobsFilter: 'all',
  teamFilter: 'all',
  tableSearch: '',
  analyticsJobStatusFilter: [],
  analyticsCandStageFilter: [],
  globalSearch: '',
  jobsSortKey: 'id',
  jobsSortAsc: true,
  analyticsSubtab: 'jobs-data',
  stageFilters: {
    screening: { interviewStatus: [], cheatProb: [], recruiterScreening: [], scoreMin: null, scoreMax: null },
    functional: { interviewStatus: [], cheatProb: [], recruiterScreening: [], scoreMin: null, scoreMax: null, actions: [] }
  },
  dateRange: 'all',
  customDateFrom: '',
  customDateTo: '',
  resumeStageView: 'all',

  // The org's system-assigned public career subdomain, mirrored from the backend
  // org record (see applyCareerDomain in mount.js). The Career-view jobs panel
  // builds its "View live" links from this.
  careerSubdomain: '',

  // In API mode the demo seed below must never paint: these flip true once the
  // live backend has hydrated jobs / usage so renderers can gate on real data.
  jobsHydrated: false,
  usageHydrated: false,

  jobs: [
    {
      id: 'AKRO62EF45E26EA1',
      roleName: 'Government Tender & Proposal Executive',
      cardName: 'Government Tender & Proposal Executive..',
      created: '10/03/2026, 04:08 PM',
      status: 'published',
      customJobId: '-',
      experienceBand: 'Upto 2 Years',
      createdBy: 'Devasri',
      description: "We are seeking a detail-oriented Government Tender & Proposal Executive to manage and lead the preparation, review, and submission of bids, tenders, and proposals for public sector opportunities. Key duties include analyzing RFP guidelines, checking compliance matrices, and writing clear technical and operational responses.",
      pipeline: {
        total: 10,
        resume: 3,
        screening: 3,
        functional: 4
      },
      resumeCriteria: {
        mustHave: [
          'Experience with government tendering portals (GeM, CPPP, e-Procurement)',
          'Strong written communication for proposal drafting',
          'Understanding of compliance requirements for public sector bids'
        ],
        redFlags: [
          'No prior exposure to government or public sector workflows',
          'Only private-sector sales or marketing background',
          'Resume lacks mention of documentation, RFP, or bidding processes'
        ],
        goodToHave: [
          'Experience with SAP Ariba or similar procurement platforms',
          'Knowledge of financial proposal preparation and costing',
          'Prior coordination with legal teams for contract reviews'
        ],
        goodToHaveMinMatch: 1
      },
      pipelineConfig: {
        careerPage: { enabled: true, listed: true },
        resumeAnalysis: { enabled: false },
        recruiterScreening: { enabled: false },
        functionalInterview: { enabled: true }
      },
      screeningParams: [
        { category: 'Experience', params: [
          { name: 'Total Experience', required: false, flexibility: '', preferredResponse: 'Only 3+ year experience allowed' },
          { name: 'Relevant Experience', required: false, flexibility: '', preferredResponse: '2+ year relevant experience only' }
        ]},
        { category: 'Location', params: [
          { name: 'Current Location', required: true, flexibility: '', preferredResponse: 'Mumbai or Pune' },
          { name: 'Ready to relocate', required: false, flexibility: '', preferredResponse: 'yes / no' }
        ]},
        { category: 'Compensation', params: [
          { name: 'Current CTC', required: true, flexibility: '', preferredResponse: 'Should be above 6 LPA' },
          { name: 'Expected CTC', required: true, flexibility: '', preferredResponse: 'Should be under 10 LPA' }
        ]},
        { category: 'Availability', params: [
          { name: 'Notice Period', required: true, flexibility: '', preferredResponse: '30 days or less' }
        ]}
      ],
      applicationFields: ['Current Location', 'Expected CTC', 'Notice Period'],
      questions: [
        {
          id: 'q-prop-1',
          type: 'technical',
          question: "Explain the process of drafting a government RFP response. What are the key compliance elements you verify before submission?",
          difficulty: 'intermediate',
          rubric: "Identifies compliance checklists, standard submission formats, and verification protocols.",
          follow_ups: ["How do you handle late updates to tender guidelines?", "What tools do you use for tracking deadline milestones?"]
        },
        {
          id: 'q-prop-2',
          type: 'behavioral',
          question: "Describe a time when you had to meet an extremely tight deadline for a critical proposal. How did you organize your tasks?",
          difficulty: 'beginner',
          rubric: "Mentions prioritization, time management, keeping key stakeholders aligned, and maintaining accuracy under pressure.",
          follow_ups: ["Did you make any errors in that rush?", "What would you do differently next time?"]
        },
        {
          id: 'q-prop-3',
          type: 'situational',
          question: "A key subject matter expert (SME) fails to deliver their input 2 hours before a tender submission deadline. How do you handle this?",
          difficulty: 'advanced',
          rubric: "Proposes logical mitigation strategies like escalation plans, using boilerplate content, or direct intervention to secure crucial technical details.",
          follow_ups: ["How do you prevent this issue in advance?", "How do you communicate the emergency to leadership?"]
        }
      ]
    },
    {
      id: 'AKRO62EF45E26DF5',
      roleName: 'Full Stack Developer',
      cardName: 'Full Stack Developer Hiring - Demo',
      created: '03/03/2026, 11:17 AM',
      status: 'published',
      customJobId: '-',
      experienceBand: '1-4 Years',
      createdBy: 'Devasri',
      description: "We are hiring a Full Stack Developer to design, build, and support high-performance web applications. You will work with React on the frontend, Node.js and Express on the backend, and PostgreSQL for storage. Responsibilities include building responsive dashboards, optimizing latency, and ensuring data consistency across endpoints.",
      pipeline: {
        total: 10,
        resume: 4,
        screening: 3,
        functional: 3
      },
      resumeCriteria: {
        mustHave: [
          'Proficiency in React or equivalent frontend framework',
          'Backend experience with Node.js, Express, or similar',
          'Database experience with PostgreSQL, MongoDB, or equivalent'
        ],
        redFlags: [
          'Resume lacks specific mention of web development technologies',
          'Only academic projects with no professional experience',
          'Experience limited to unrelated fields without transferable skills'
        ],
        goodToHave: [
          'Experience with Docker, Kubernetes, or cloud platforms (AWS/GCP)',
          'Familiarity with CI/CD pipelines and DevOps practices',
          'Open source contributions or published technical blog posts'
        ],
        goodToHaveMinMatch: 1
      },
      pipelineConfig: {
        careerPage: { enabled: true, listed: true },
        resumeAnalysis: { enabled: true },
        recruiterScreening: { enabled: true },
        functionalInterview: { enabled: true }
      },
      screeningParams: [
        { category: 'Experience', params: [
          { name: 'Total Experience', required: true, flexibility: '', preferredResponse: '1-4 years of full stack development' },
          { name: 'Relevant Experience', required: true, flexibility: '', preferredResponse: '1+ years with React and Node.js' }
        ]},
        { category: 'Location', params: [
          { name: 'Current Location', required: false, flexibility: '', preferredResponse: 'Remote or Bangalore' },
          { name: 'Ready to relocate', required: false, flexibility: '', preferredResponse: 'Flexible' }
        ]},
        { category: 'Compensation', params: [
          { name: 'Current CTC', required: true, flexibility: '', preferredResponse: 'Should be above 4 LPA' },
          { name: 'Expected CTC', required: true, flexibility: '', preferredResponse: 'Should be under 12 LPA' }
        ]},
        { category: 'Availability', params: [
          { name: 'Notice Period', required: true, flexibility: '', preferredResponse: '15 days or less' }
        ]}
      ],
      applicationFields: ['Current Location', 'Expected CTC', 'Notice Period', 'GitHub Profile'],
      questions: [
        {
          id: 'q-dev-1',
          type: 'technical',
          question: "Describe the differences between optimistic UI updates and pessimistic UI updates. When would you use each?",
          difficulty: 'intermediate',
          rubric: "Explains user experience vs data consistency, error handling, and rollback logic in state managers.",
          follow_ups: ["How do you handle temporary network failures?", "Can you describe a scenario where optimistic updates fail badly?"]
        },
        {
          id: 'q-dev-2',
          type: 'behavioral',
          question: "Tell me about a time you had a technical disagreement with a team lead or colleague. How was it resolved?",
          difficulty: 'beginner',
          rubric: "Highlights constructive communication, presenting data-backed arguments, testing hypotheses, and committing to the final team decision.",
          follow_ups: ["What did you learn from their perspective?", "Did it affect your working relationship afterwards?"]
        },
        {
          id: 'q-dev-3',
          type: 'situational',
          question: "We are experiencing a sudden spike in database read latency during peak hours. Walk me through your debugging steps.",
          difficulty: 'advanced',
          rubric: "Mentions slow query logs, connection pools, indexing, caching layers (Redis), replica scaling, and server utilization checks.",
          follow_ups: ["How would you explain the downtime to a non-technical manager?", "What long-term safeguards would you set up?"]
        }
      ]
    }
  ] as unknown as Job[],

  candidates: [
    {
      id: 'CAN-8234-EA1',
      name: 'Aditya Rana',
      email: 'aditya@IntervieHire.com',
      jobApplied: 'Full Stack Developer',
      status: 'Functional',
      score: '94%',
      registeredOn: '04 Mar 2026, 10:15 AM',
      phone: '8869889654',
      source: 'Direct Link',
      attemptedAt: 'Mar 22, 2026 11:57 PM',
      interviewStatus: 'Completed',
      cheatProbability: 'Low',
      interviewScore: 71,
      recruiterScreening: 'Good fit',
      recruiterScreeningScore: 100
    },
    {
      id: 'CAN-7128-DF5',
      name: 'Devasri Bali',
      email: 'devasri@company.com',
      jobApplied: 'Government Tender & Proposal Executive',
      status: 'Functional',
      score: '96%',
      registeredOn: '11 Mar 2026, 02:40 PM',
      phone: '9876543210',
      source: 'Scheduled',
      attemptedAt: 'Mar 18, 2026 03:15 PM',
      interviewStatus: 'Completed',
      cheatProbability: 'Low',
      interviewScore: 85,
      recruiterScreening: 'Good fit',
      recruiterScreeningScore: 92
    },
    {
      id: 'CAN-3401-EA1',
      name: 'Ines Caetano',
      email: 'ines@design.io',
      jobApplied: 'Government Tender & Proposal Executive',
      status: 'Screening',
      score: '87%',
      registeredOn: '12 Mar 2026, 09:12 AM',
      phone: '9999999999',
      source: 'Direct Link',
      attemptedAt: 'Mar 22, 2026 11:57 PM',
      interviewStatus: 'Incomplete',
      cheatProbability: null,
      interviewScore: null,
      recruiterScreening: null,
      recruiterScreeningScore: null
    },
    {
      id: 'CAN-9012-EA2',
      name: 'Sarah Jenkins',
      email: 'sarah.j@techcorp.com',
      jobApplied: 'Government Tender & Proposal Executive',
      status: 'Screening',
      score: '91%',
      registeredOn: '13 Mar 2026, 11:05 AM',
      phone: '8869889654',
      source: 'Scheduled',
      attemptedAt: null,
      interviewStatus: 'Slot Missed',
      cheatProbability: null,
      interviewScore: null,
      recruiterScreening: null,
      recruiterScreeningScore: null
    },
    {
      id: 'CAN-4402-RA1',
      name: 'Rohan Mehta',
      email: 'rohan.mehta@hire.io',
      jobApplied: 'Full Stack Developer',
      status: 'Resume',
      score: '—',
      registeredOn: '28 May 2026, 09:00 AM',
      phone: '7012345678',
      source: 'Career Page',
      attemptedAt: null,
      interviewStatus: null,
      cheatProbability: null,
      interviewScore: null,
      recruiterScreening: null,
      recruiterScreeningScore: null
    },
    {
      id: 'CAN-5501-RA2',
      name: 'Priya Sharma',
      email: 'priya.sharma@bd.in',
      jobApplied: 'Government Tender & Proposal Executive',
      status: 'Resume',
      score: '—',
      registeredOn: '28 May 2026, 10:30 AM',
      phone: '9988776655',
      source: 'Bulk Upload',
      attemptedAt: null,
      interviewStatus: null,
      cheatProbability: null,
      interviewScore: null,
      recruiterScreening: null,
      recruiterScreeningScore: null
    },
    {
      id: 'CAN-5502-RA3',
      name: 'Arjun Verma',
      email: 'arjun.v@proposals.co',
      jobApplied: 'Government Tender & Proposal Executive',
      status: 'Resume',
      score: '—',
      registeredOn: '28 May 2026, 11:15 AM',
      phone: '8877665544',
      source: 'ATS',
      attemptedAt: null,
      interviewStatus: null,
      cheatProbability: null,
      interviewScore: null,
      recruiterScreening: null,
      recruiterScreeningScore: null
    },
    {
      id: 'CAN-6601-FK1',
      name: 'Meera Kapoor',
      email: 'meera.kapoor@outlook.com',
      jobApplied: 'Full Stack Developer',
      status: 'Functional',
      score: '88%',
      registeredOn: '02 Apr 2026, 03:20 PM',
      phone: '9123456789',
      source: 'Career Page',
      attemptedAt: 'Apr 15, 2026 10:30 AM',
      interviewStatus: 'Completed',
      cheatProbability: 'Low',
      interviewScore: 78,
      recruiterScreening: 'Good fit',
      recruiterScreeningScore: 88
    },
    {
      id: 'CAN-6602-FK2',
      name: 'Vikram Singh',
      email: 'vikram.singh@techmail.com',
      jobApplied: 'Full Stack Developer',
      status: 'Screening',
      score: '72%',
      registeredOn: '05 Apr 2026, 09:45 AM',
      phone: '9234567890',
      source: 'ATS',
      attemptedAt: 'Apr 18, 2026 02:00 PM',
      interviewStatus: 'Incomplete',
      cheatProbability: 'Medium',
      interviewScore: null,
      recruiterScreening: 'Moderate fit',
      recruiterScreeningScore: 65
    },
    {
      id: 'CAN-6603-FK3',
      name: 'Ananya Reddy',
      email: 'ananya.r@devstudio.in',
      jobApplied: 'Full Stack Developer',
      status: 'Resume',
      score: '—',
      registeredOn: '10 Apr 2026, 01:30 PM',
      phone: '9345678901',
      source: 'Bulk Upload',
      attemptedAt: null,
      interviewStatus: null,
      cheatProbability: null,
      interviewScore: null,
      recruiterScreening: null,
      recruiterScreeningScore: null
    },
    {
      id: 'CAN-7701-GT1',
      name: 'Kavya Nair',
      email: 'kavya.nair@govwork.in',
      jobApplied: 'Government Tender & Proposal Executive',
      status: 'Functional',
      score: '82%',
      registeredOn: '15 Mar 2026, 04:10 PM',
      phone: '9456789012',
      source: 'Scheduled',
      attemptedAt: 'Mar 28, 2026 09:00 AM',
      interviewStatus: 'Completed',
      cheatProbability: 'Low',
      interviewScore: 69,
      recruiterScreening: 'Good fit',
      recruiterScreeningScore: 85
    },
    {
      id: 'CAN-7702-GT2',
      name: 'Rahul Gupta',
      email: 'rahul.gupta@bidpro.com',
      jobApplied: 'Government Tender & Proposal Executive',
      status: 'Screening',
      score: '78%',
      registeredOn: '18 Mar 2026, 10:00 AM',
      phone: '9567890123',
      source: 'Career Page',
      attemptedAt: 'Apr 02, 2026 11:15 AM',
      interviewStatus: 'Completed',
      cheatProbability: 'High',
      interviewScore: 42,
      recruiterScreening: 'Poor fit',
      recruiterScreeningScore: 38
    },
    {
      id: 'CAN-7703-GT3',
      name: 'Neha Patil',
      email: 'neha.patil@tenderex.co',
      jobApplied: 'Government Tender & Proposal Executive',
      status: 'Resume',
      score: '—',
      registeredOn: '20 Apr 2026, 08:30 AM',
      phone: '9678901234',
      source: 'Direct Link',
      attemptedAt: null,
      interviewStatus: null,
      cheatProbability: null,
      interviewScore: null,
      recruiterScreening: null,
      recruiterScreeningScore: null
    },
    {
      id: 'CAN-8801-FK4',
      name: 'Shreya Joshi',
      email: 'shreya.j@codecraft.io',
      jobApplied: 'Full Stack Developer',
      status: 'Screening',
      score: '85%',
      registeredOn: '22 Apr 2026, 11:00 AM',
      phone: '9789012345',
      source: 'Scheduled',
      attemptedAt: 'May 01, 2026 03:45 PM',
      interviewStatus: 'Slot Missed',
      cheatProbability: null,
      interviewScore: null,
      recruiterScreening: 'Moderate fit',
      recruiterScreeningScore: 70
    },
    {
      id: 'CAN-8802-FK5',
      name: 'Karthik Iyer',
      email: 'karthik.i@fullstack.dev',
      jobApplied: 'Full Stack Developer',
      status: 'Functional',
      score: '91%',
      registeredOn: '25 Apr 2026, 09:15 AM',
      phone: '9890123456',
      source: 'ATS',
      attemptedAt: 'May 10, 2026 10:00 AM',
      interviewStatus: 'Completed',
      cheatProbability: 'Low',
      interviewScore: 83,
      recruiterScreening: 'Good fit',
      recruiterScreeningScore: 95
    },
    {
      id: 'CAN-9901-GT4',
      name: 'Amit Saxena',
      email: 'amit.sax@procure.gov',
      jobApplied: 'Government Tender & Proposal Executive',
      status: 'Screening',
      score: '68%',
      registeredOn: '01 May 2026, 02:20 PM',
      phone: '9901234567',
      source: 'Bulk Upload',
      attemptedAt: 'May 15, 2026 04:30 PM',
      interviewStatus: 'Incomplete',
      cheatProbability: 'Medium',
      interviewScore: null,
      recruiterScreening: null,
      recruiterScreeningScore: null
    },
    {
      id: 'CAN-9902-FK6',
      name: 'Divya Menon',
      email: 'divya.m@webworks.co',
      jobApplied: 'Full Stack Developer',
      status: 'Resume',
      score: '—',
      registeredOn: '05 May 2026, 10:45 AM',
      phone: '8012345678',
      source: 'Career Page',
      attemptedAt: null,
      interviewStatus: null,
      cheatProbability: null,
      interviewScore: null,
      recruiterScreening: null,
      recruiterScreeningScore: null
    },
    {
      id: 'CAN-9903-GT5',
      name: 'Pooja Deshmukh',
      email: 'pooja.d@tenders.in',
      jobApplied: 'Government Tender & Proposal Executive',
      status: 'Resume',
      score: '—',
      registeredOn: '08 May 2026, 03:00 PM',
      phone: '8123456789',
      source: 'ATS',
      attemptedAt: null,
      interviewStatus: null,
      cheatProbability: null,
      interviewScore: null,
      recruiterScreening: null,
      recruiterScreeningScore: null
    },
    {
      id: 'CAN-1001-FK7',
      name: 'Siddharth Rao',
      email: 'sid.rao@devhub.in',
      jobApplied: 'Full Stack Developer',
      status: 'Resume',
      score: '—',
      registeredOn: '12 May 2026, 08:00 AM',
      phone: '8234567890',
      source: 'Direct Link',
      attemptedAt: null,
      interviewStatus: null,
      cheatProbability: null,
      interviewScore: null,
      recruiterScreening: null,
      recruiterScreeningScore: null
    },
    {
      id: 'CAN-1101-FK8',
      name: 'Tanvi Kulkarni',
      email: 'tanvi.k@stackops.io',
      jobApplied: 'Full Stack Developer',
      status: 'Screening',
      score: '76%',
      registeredOn: '14 May 2026, 11:20 AM',
      phone: '8345678901',
      source: 'Career Page',
      attemptedAt: 'May 20, 2026 02:00 PM',
      interviewStatus: 'Completed',
      cheatProbability: 'Low',
      interviewScore: 62,
      recruiterScreening: 'Moderate fit',
      recruiterScreeningScore: 68
    },
    {
      id: 'CAN-1102-GT6',
      name: 'Manish Tiwari',
      email: 'manish.t@govbids.co',
      jobApplied: 'Government Tender & Proposal Executive',
      status: 'Functional',
      score: '74%',
      registeredOn: '16 Mar 2026, 09:30 AM',
      phone: '8456789012',
      source: 'Direct Link',
      attemptedAt: 'Apr 05, 2026 10:45 AM',
      interviewStatus: 'Completed',
      cheatProbability: 'Medium',
      interviewScore: 58,
      recruiterScreening: 'Moderate fit',
      recruiterScreeningScore: 72
    },
    {
      id: 'CAN-1103-FK9',
      name: 'Riya Patel',
      email: 'riya.p@frontend.dev',
      jobApplied: 'Full Stack Developer',
      status: 'Hired',
      score: '97%',
      registeredOn: '01 Mar 2026, 08:45 AM',
      phone: '8567890123',
      source: 'ATS',
      attemptedAt: 'Mar 15, 2026 09:00 AM',
      interviewStatus: 'Completed',
      cheatProbability: 'Low',
      interviewScore: 94,
      recruiterScreening: 'Good fit',
      recruiterScreeningScore: 98
    },
    {
      id: 'CAN-1104-GT7',
      name: 'Suresh Pandey',
      email: 'suresh.p@tendermgmt.in',
      jobApplied: 'Government Tender & Proposal Executive',
      status: 'Hired',
      score: '89%',
      registeredOn: '08 Mar 2026, 02:15 PM',
      phone: '8678901234',
      source: 'Scheduled',
      attemptedAt: 'Mar 25, 2026 11:30 AM',
      interviewStatus: 'Completed',
      cheatProbability: 'Low',
      interviewScore: 87,
      recruiterScreening: 'Good fit',
      recruiterScreeningScore: 91
    },
    {
      id: 'CAN-1105-FK10',
      name: 'Nikhil Sharma',
      email: 'nikhil.s@backend.io',
      jobApplied: 'Full Stack Developer',
      status: 'Screening',
      score: '81%',
      registeredOn: '18 Apr 2026, 10:00 AM',
      phone: '8789012345',
      source: 'Scheduled',
      attemptedAt: 'May 05, 2026 01:30 PM',
      interviewStatus: 'Completed',
      cheatProbability: 'Medium',
      interviewScore: 55,
      recruiterScreening: 'Moderate fit',
      recruiterScreeningScore: 60
    },
    {
      id: 'CAN-1106-GT8',
      name: 'Lakshmi Iyer',
      email: 'lakshmi.i@procurehub.com',
      jobApplied: 'Government Tender & Proposal Executive',
      status: 'Screening',
      score: '83%',
      registeredOn: '22 Mar 2026, 03:40 PM',
      phone: '8890123456',
      source: 'Career Page',
      attemptedAt: 'Apr 10, 2026 09:15 AM',
      interviewStatus: 'Completed',
      cheatProbability: 'Low',
      interviewScore: 73,
      recruiterScreening: 'Good fit',
      recruiterScreeningScore: 82
    },
    {
      id: 'CAN-1107-FK11',
      name: 'Abhishek Verma',
      email: 'abhishek.v@nodestack.dev',
      jobApplied: 'Full Stack Developer',
      status: 'Functional',
      score: '90%',
      registeredOn: '20 Mar 2026, 01:00 PM',
      phone: '8901234567',
      source: 'Direct Link',
      attemptedAt: 'Apr 08, 2026 11:00 AM',
      interviewStatus: 'Completed',
      cheatProbability: 'Low',
      interviewScore: 81,
      recruiterScreening: 'Good fit',
      recruiterScreeningScore: 90
    },
    {
      id: 'CAN-1108-GT9',
      name: 'Fatima Sheikh',
      email: 'fatima.s@bidconsult.in',
      jobApplied: 'Government Tender & Proposal Executive',
      status: 'Screening',
      score: '71%',
      registeredOn: '25 Mar 2026, 08:50 AM',
      phone: '9012345679',
      source: 'Bulk Upload',
      attemptedAt: null,
      interviewStatus: 'Not Started',
      cheatProbability: null,
      interviewScore: null,
      recruiterScreening: null,
      recruiterScreeningScore: null
    },
    {
      id: 'CAN-1109-FK12',
      name: 'Sneha Reddy',
      email: 'sneha.r@reactlab.co',
      jobApplied: 'Full Stack Developer',
      status: 'Resume',
      score: '—',
      registeredOn: '15 May 2026, 04:00 PM',
      phone: '7123456789',
      source: 'Career Page',
      attemptedAt: null,
      interviewStatus: null,
      cheatProbability: null,
      interviewScore: null,
      recruiterScreening: null,
      recruiterScreeningScore: null
    },
    {
      id: 'CAN-1110-GT10',
      name: 'Rajesh Kumar',
      email: 'rajesh.k@govpro.org',
      jobApplied: 'Government Tender & Proposal Executive',
      status: 'Resume',
      score: '—',
      registeredOn: '18 May 2026, 09:30 AM',
      phone: '7234567890',
      source: 'Direct Link',
      attemptedAt: null,
      interviewStatus: null,
      cheatProbability: null,
      interviewScore: null,
      recruiterScreening: null,
      recruiterScreeningScore: null
    },
    {
      id: 'CAN-1111-FK13',
      name: 'Varun Agarwal',
      email: 'varun.a@clouddev.io',
      jobApplied: 'Full Stack Developer',
      status: 'Screening',
      score: '79%',
      registeredOn: '28 Apr 2026, 02:30 PM',
      phone: '7345678901',
      source: 'ATS',
      attemptedAt: 'May 12, 2026 10:00 AM',
      interviewStatus: 'Completed',
      cheatProbability: 'High',
      interviewScore: 38,
      recruiterScreening: 'Poor fit',
      recruiterScreeningScore: 35
    },
    {
      id: 'CAN-1112-GT11',
      name: 'Deepika Nair',
      email: 'deepika.n@tenderpro.in',
      jobApplied: 'Government Tender & Proposal Executive',
      status: 'Functional',
      score: '86%',
      registeredOn: '10 Mar 2026, 11:45 AM',
      phone: '7456789012',
      source: 'ATS',
      attemptedAt: 'Mar 30, 2026 02:30 PM',
      interviewStatus: 'Incomplete',
      cheatProbability: 'Low',
      interviewScore: null,
      recruiterScreening: 'Good fit',
      recruiterScreeningScore: 88
    },
    {
      id: 'CAN-1113-FK14',
      name: 'Harsh Gupta',
      email: 'harsh.g@apiforge.dev',
      jobApplied: 'Full Stack Developer',
      status: 'Hired',
      score: '95%',
      registeredOn: '25 Feb 2026, 09:00 AM',
      phone: '7567890123',
      source: 'Scheduled',
      attemptedAt: 'Mar 10, 2026 10:30 AM',
      interviewStatus: 'Completed',
      cheatProbability: 'Low',
      interviewScore: 92,
      recruiterScreening: 'Good fit',
      recruiterScreeningScore: 96
    },
    {
      id: 'CAN-1114-GT12',
      name: 'Swati Mishra',
      email: 'swati.m@compliance.co',
      jobApplied: 'Government Tender & Proposal Executive',
      status: 'Screening',
      score: '75%',
      registeredOn: '28 Mar 2026, 01:20 PM',
      phone: '7678901234',
      source: 'Scheduled',
      attemptedAt: 'Apr 15, 2026 03:00 PM',
      interviewStatus: 'Incomplete',
      cheatProbability: null,
      interviewScore: null,
      recruiterScreening: 'Moderate fit',
      recruiterScreeningScore: 62
    },
    {
      id: 'CAN-1115-FK15',
      name: 'Anjali Desai',
      email: 'anjali.d@microserv.io',
      jobApplied: 'Full Stack Developer',
      status: 'Resume',
      score: '—',
      registeredOn: '20 May 2026, 11:00 AM',
      phone: '7789012345',
      source: 'Bulk Upload',
      attemptedAt: null,
      interviewStatus: null,
      cheatProbability: null,
      interviewScore: null,
      recruiterScreening: null,
      recruiterScreeningScore: null
    },
    {
      id: 'CAN-1116-GT13',
      name: 'Vikrant Chauhan',
      email: 'vikrant.c@rfpmaster.com',
      jobApplied: 'Government Tender & Proposal Executive',
      status: 'Resume',
      score: '—',
      registeredOn: '22 May 2026, 02:45 PM',
      phone: '7890123456',
      source: 'Career Page',
      attemptedAt: null,
      interviewStatus: null,
      cheatProbability: null,
      interviewScore: null,
      recruiterScreening: null,
      recruiterScreeningScore: null
    }
  ] as unknown as Candidate[],

  team: [
    {
      name: 'Devasri',
      email: 'devasri@interviehire.ai',
      designation: 'Org. Admin',
      usertype: 'Org. Admin',
      registeredOn: '26 Feb 2026, 05:33 PM',
      status: 'Active'
    }
  ] as TeamMember[],
  visibleColumnsAnalyticsJobs: ['id', 'roleName', 'cardName', 'customJobId', 'experienceBand', 'tags', 'createdBy', 'collaborators', 'recruiters'],
  visibleColumnsAnalyticsCandidates: ['id', 'name', 'jobApplied', 'registeredOn', 'status', 'score', 'actions'],
  visibleColumnsTeam: ['member', 'designation', 'usertype', 'registeredOn', 'status', 'actions'],
  agentConfigs: {
    aria: {
      model: 'gpt-4o',
      temperature: 0.2,
      threshold: 80,
      prompt: 'You are Lina, the Resume Analyst Agent. Your job is to extract candidate experience, skills, and check eligibility for public tenders. Screen out any profiles below the match score threshold.'
    },
    kaelen: {
      model: 'claude-3-5-sonnet',
      temperature: 0.5,
      threshold: 85,
      prompt: 'You are Kaelen, the Technical Vetting Specialist. Evaluate code submissions for correctness, clean structure, memory leak preventions, and correct algorithmic complexity.'
    },
    lyra: {
      model: 'gpt-4o',
      temperature: 0.7,
      threshold: 75,
      prompt: 'You are Lyra, the HR Communications Bot. Draft friendly invitations to candidates, schedule interviews, and handle follow-up emails regarding their screening status.'
    }
  }
};


// Helper for generating custom job IDs
function generateJobId() {
  const chars = '0123456789ABCDEF';
  let id = 'AKRO62EF45E2';
  for (let i = 0; i < 4; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

// Per-job interview settings (camelCase end-to-end: dashboard → backend JSON
// column → engine InterviewSession.settings). Defaults mirror the modal's
// initial toggle state. The engine treats missing values as permissive.
function defaultInterviewSettings() {
  return {
    interviewEnabled: true,
    allowMobile: false,
    allowLate: false,
    continueFromMiddle: true,
    allowReattempt: false,
    requireCv: true,
    proctoring: true,
    conversationalInterview: false,
    whiteLabel: false,
    accessControl: 'link',
  };
}


export { AppState, generateJobId, defaultInterviewSettings };
