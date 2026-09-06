import sys
from app.database import SessionLocal, Base, engine
from app.models.user import User, UserStatus, UserType
from app.models.job import Job, JobStatus, JobCollaborator
from app.models.applicant import Applicant, InterviewStatus, CheatProbability, ApplicantSource
from app.models.organisation import Organisation
from app.utils.auth import get_password_hash
from datetime import datetime

def seed():
    # Make sure tables exist
    Base.metadata.create_all(bind=engine)
    
    db = SessionLocal()
    try:
        print("Cleaning up database tables to perform a clean seed...")
        # Clean in correct dependency order
        db.query(JobCollaborator).delete()
        db.query(Applicant).delete()
        db.query(Job).delete()
        db.query(User).delete()
        db.query(Organisation).delete()
        db.commit()

        print("Seeding organisations...")
        # 1. devasri-tech
        org1 = Organisation(
            org_name="devasri-tech",
            domain="devasri-tech.zeko.ai",
            contact_email="devasri@zeko.ai",
            website_link="https://zeko.ai",
            location="Remote",
            description="Build the future of technology with us."
        )
        db.add(org1)
        
        # 2. DesignIO
        org2 = Organisation(
            org_name="DesignIO",
            domain="design.io",
            contact_email="hello@design.io",
            website_link="https://design.io",
            location="San Francisco",
            description="Creating beautiful interfaces."
        )
        db.add(org2)
        db.commit()
        db.refresh(org1)
        db.refresh(org2)

        print("Seeding Super Admin user...")
        super_admin = User(
            name="Super Admin",
            email="org_admin@interviehire.com",
            designation="Org. Admin",
            user_type=UserType.org_admin,
            status=UserStatus.active,
            hashed_password=get_password_hash("org_adminpassword"),
            organisation_id=None
        )
        db.add(super_admin)

        print("Seeding dedicated Superadmin user...")
        superadmin = User(
            name="Superadmin",
            email="superadmin@interviehire.com",
            designation="Superadmin",
            user_type=UserType.super_admin,
            status=UserStatus.active,
            hashed_password=get_password_hash("superadminpass"),
            organisation_id=None
        )
        db.add(superadmin)

        print("Seeding devasri-tech users...")
        # Org Admin
        admin1 = User(
            name="Devasri",
            email="devasri@zeko.ai",
            designation="Org. Admin",
            user_type=UserType.org_admin,
            status=UserStatus.active,
            hashed_password=get_password_hash("orgpassword"),
            organisation_id=org1.id
        )
        # Member 1 (Aditya)
        member1_org1 = User(
            name="Aditya",
            email="aditya@zeko.ai",
            designation="Recruiter",
            user_type=UserType.member,
            status=UserStatus.active,
            hashed_password=get_password_hash("memberpassword"),
            organisation_id=org1.id
        )
        # Member 2 (Aditya Member 2)
        member2_org1 = User(
            name="Aditya Colleague",
            email="aditya_member2@zeko.ai",
            designation="Recruiter",
            user_type=UserType.member,
            status=UserStatus.active,
            hashed_password=get_password_hash("memberpassword"),
            organisation_id=org1.id
        )
        db.add_all([admin1, member1_org1, member2_org1])

        print("Seeding DesignIO users...")
        # Org Admin (new!)
        admin2 = User(
            name="Design Admin",
            email="design_admin@design.io",
            designation="Design Admin",
            user_type=UserType.org_admin,
            status=UserStatus.active,
            hashed_password=get_password_hash("orgpassword"),
            organisation_id=org2.id
        )
        # Member 1
        member1_org2 = User(
            name="Design Recruiter 1",
            email="design_member1@design.io",
            designation="UX Recruiter",
            user_type=UserType.member,
            status=UserStatus.active,
            hashed_password=get_password_hash("memberpassword"),
            organisation_id=org2.id
        )
        # Member 2
        member2_org2 = User(
            name="Design Recruiter 2",
            email="design_member2@design.io",
            designation="UI Recruiter",
            user_type=UserType.member,
            status=UserStatus.active,
            hashed_password=get_password_hash("memberpassword"),
            organisation_id=org2.id
        )
        db.add_all([admin2, member1_org2, member2_org2])
        db.commit()

        # Refresh all users to get their IDs
        db.refresh(admin1)
        db.refresh(member1_org1)
        db.refresh(member2_org1)
        db.refresh(admin2)
        db.refresh(member1_org2)
        db.refresh(member2_org2)

        print("Seeding devasri-tech jobs...")
        # Keep at least 3 jobs under devasri-tech
        job1_org1 = Job(
            custom_job_id="AKRO62EF45E26EA1",
            role_name="Government Tender & Proposal Executive",
            title="Government Tender & Proposal Executive..",
            status=JobStatus.published,
            experience_band="Upto 2 Years",
            is_job_listed=True,
            created_by_id=admin1.id,
            organisation_id=org1.id
        )
        job2_org1 = Job(
            custom_job_id="AKRO62EF45E26DF5",
            role_name="Full Stack Developer",
            title="Full Stack Developer Hiring - Demo",
            status=JobStatus.published,
            experience_band="1-4 Years",
            is_job_listed=True,
            created_by_id=admin1.id,
            organisation_id=org1.id
        )
        job3_org1 = Job(
            custom_job_id="AKRO62EF45E26NEW",
            role_name="DevOps Engineer",
            title="DevOps Engineer Hiring - Demo",
            status=JobStatus.published,
            experience_band="2-5 Years",
            is_job_listed=True,
            created_by_id=admin1.id,
            organisation_id=org1.id
        )
        db.add_all([job1_org1, job2_org1, job3_org1])

        print("Seeding DesignIO jobs...")
        # Keep at least 3 jobs under DesignIO
        job1_org2 = Job(
            custom_job_id="DESN99F12345E67A",
            role_name="UI/UX Designer",
            title="Lead UI/UX Designer Position",
            status=JobStatus.published,
            experience_band="3-6 Years",
            is_job_listed=True,
            created_by_id=admin2.id,
            organisation_id=org2.id
        )
        job2_org2 = Job(
            custom_job_id="DESN99F12345E67B",
            role_name="Product Designer",
            title="Product Designer Position",
            status=JobStatus.published,
            experience_band="2-4 Years",
            is_job_listed=True,
            created_by_id=admin2.id,
            organisation_id=org2.id
        )
        job3_org2 = Job(
            custom_job_id="DESN99F12345E67C",
            role_name="Graphic Designer",
            title="Graphic Designer Position",
            status=JobStatus.published,
            experience_band="0-2 Years",
            is_job_listed=True,
            created_by_id=admin2.id,
            organisation_id=org2.id
        )
        db.add_all([job1_org2, job2_org2, job3_org2])
        db.commit()

        # Refresh jobs to get IDs
        db.refresh(job1_org1)
        db.refresh(job2_org1)
        db.refresh(job3_org1)
        db.refresh(job1_org2)
        db.refresh(job2_org2)
        db.refresh(job3_org2)

        print("Assigning collaborators to jobs...")
        # 1 job common between devasri-tech members, other 2 jobs different
        c1_1 = JobCollaborator(job_id=job1_org1.id, user_id=member1_org1.id) # Common Job
        c1_2 = JobCollaborator(job_id=job1_org1.id, user_id=member2_org1.id) # Common Job
        c2_1 = JobCollaborator(job_id=job2_org1.id, user_id=member1_org1.id) # Member 1 unique Job
        c3_2 = JobCollaborator(job_id=job3_org1.id, user_id=member2_org1.id) # Member 2 unique Job
        db.add_all([c1_1, c1_2, c2_1, c3_2])

        # 1 job common between DesignIO members, other 2 jobs different
        c4_1 = JobCollaborator(job_id=job1_org2.id, user_id=member1_org2.id) # Common Job
        c4_2 = JobCollaborator(job_id=job1_org2.id, user_id=member2_org2.id) # Common Job
        c5_1 = JobCollaborator(job_id=job2_org2.id, user_id=member1_org2.id) # Member 1 unique Job
        c6_2 = JobCollaborator(job_id=job3_org2.id, user_id=member2_org2.id) # Member 2 unique Job
        db.add_all([c4_1, c4_2, c5_1, c6_2])

        print("Seeding applicants...")
        # devasri-tech applicants
        app1 = Applicant(
            name="Aditya Rana",
            email="aditya@interviehire.com",
            source=ApplicantSource.direct_link,
            job_id=job2_org1.id,
            resume_analysed=True,
            screening_status=None,
            functional_status=InterviewStatus.completed,
            functional_score=94.0,
            cheat_probability=CheatProbability.low,
            report_url="#"
        )
        app2 = Applicant(
            name="Devasri Bali",
            email="devasri@company.com",
            source=ApplicantSource.direct_link,
            job_id=job1_org1.id,
            resume_analysed=True,
            screening_status=None,
            functional_status=InterviewStatus.completed,
            functional_score=96.0,
            cheat_probability=CheatProbability.low,
            report_url="#"
        )
        app3 = Applicant(
            name="Ines Caetano",
            email="ines@design.io",
            source=ApplicantSource.scheduled,
            job_id=job1_org1.id,
            resume_analysed=True,
            screening_status=InterviewStatus.scheduled,
            screening_score=87.0,
            functional_status=None
        )
        db.add_all([app1, app2, app3])

        # DesignIO applicants
        app4 = Applicant(
            name="Emily Watson",
            email="emily@design.io",
            source=ApplicantSource.career_page,
            job_id=job1_org2.id,
            resume_analysed=True,
            screening_status=None,
            functional_status=InterviewStatus.completed,
            functional_score=89.0,
            cheat_probability=CheatProbability.low,
            report_url="#"
        )
        db.add(app4)
        
        db.commit()
        print("Database seeding completed successfully!")
    except Exception as e:
        print(f"Error during seeding: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    seed()
