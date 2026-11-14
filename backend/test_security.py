"""Run with:  python test_security.py"""
import unittest
from security import scrub_text


class ScrubTests(unittest.TestCase):
    def check(self, raw, must_not_contain, expect_type=None):
        clean, found = scrub_text(raw)
        for bad in must_not_contain:
            self.assertNotIn(bad, clean, f"leaked {bad!r} in: {clean}")
        if expect_type:
            self.assertIn(expect_type, found, f"{expect_type} not detected: {found}")
        return clean

    def test_openai_key(self):
        key = "sk-proj-" + "aB3dE5gH7jK9mN1pQ3sT5vX7"
        self.check(f"my key is {key} ok", [key], "OPENAI_KEY")

    def test_anthropic_key(self):
        key = "sk-ant-api03-" + "Zx9Yw8Vu7Ts6Rq5Po4Nm3Lk2"
        self.check(f"use {key}", [key], "ANTHROPIC_KEY")

    def test_aws_and_github(self):
        self.check("AKIAIOSFODNN7EXAMPLE", ["AKIAIOSFODNN7EXAMPLE"], "AWS_ACCESS_KEY")
        tok = "ghp_" + "a" * 36
        self.check(f"token {tok}", [tok], "GITHUB_TOKEN")

    def test_password_assignment_keeps_label(self):
        clean = self.check("DB_PASSWORD=Sup3rS3cret!", ["Sup3rS3cret"], "PASSWORD")
        self.assertIn("DB_PASSWORD=", clean)

    def test_env_style_names(self):
        self.check("MY_SECRET_KEY=abc123def456", ["abc123def456"], "PASSWORD")
        self.check("password reset flow is broken", [], None)

    def test_password_is_phrase(self):
        self.check("the admin password is hunter2xyz please fix login", ["hunter2xyz"], "PASSWORD")

    def test_connection_string(self):
        self.check("postgres://admin:p4ssw0rd@db.internal:5432/app", ["p4ssw0rd"], "CONNECTION_STRING")

    def test_private_key_block(self):
        pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEabc123\n-----END RSA PRIVATE KEY-----"
        self.check(f"here:\n{pem}", ["MIIEabc123"], "PRIVATE_KEY")

    def test_jwt(self):
        jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N"
        self.check(f"Authorization {jwt}", [jwt], "JWT")

    def test_credit_card_luhn(self):
        self.check("card 4111 1111 1111 1111 exp 12/29", ["4111 1111 1111 1111"], "CREDIT_CARD")
        clean, found = scrub_text("order id 1234 5678 9012 3456")  # fails Luhn
        self.assertNotIn("CREDIT_CARD", found)

    def test_email_phone(self):
        self.check("mail priya.sharma@acme.com", ["priya.sharma@acme.com"], "EMAIL")
        self.check("call +91 98765 43210 now", ["98765 43210"], "PHONE")
        self.check("call 9876543210 now", ["9876543210"], "PHONE")

    def test_indian_ids(self):
        self.check("PAN ABCDE1234F", ["ABCDE1234F"], "PAN")
        self.check("aadhaar 2345 6789 0123", ["2345 6789 0123"], "AADHAAR")

    def test_names(self):
        self.check("The client name is Rahul Verma and he wants a report", ["Rahul Verma"], "PERSON_NAME")
        self.check("Please email Dr. Mehta tomorrow", ["Mehta"], "PERSON_NAME")

    def test_entropy_catches_unknown_secret(self):
        secret = "q8Zk2LmP9xV4nR7tY1wB6cD3"
        self.check(f"token: {secret}", [secret])

    def test_normal_developer_text_is_untouched(self):
        text = (
            "Fix this memory leak in my C++ IoT firmware. Files: src/sensor_driver/TemperatureSensorManager.cpp. "
            "Commit 3f2a9c1 on branch feature/esp32-support, version 2.4.1, date 2026-11-13."
        )
        clean, found = scrub_text(text)
        self.assertEqual(clean, text)
        self.assertEqual(found, {})


if __name__ == "__main__":
    unittest.main(verbosity=2)
