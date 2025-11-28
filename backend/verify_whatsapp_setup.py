"""
WhatsApp Business API - Configuration Verification Script
Run this to verify your WhatsApp setup is correct before going to production
"""

import os
import requests
from dotenv import load_dotenv
import sys

load_dotenv()

# Colors for terminal output
GREEN = '\033[92m'
RED = '\033[91m'
YELLOW = '\033[93m'
BLUE = '\033[94m'
RESET = '\033[0m'

def print_success(message):
    print(f"{GREEN}✅ {message}{RESET}")

def print_error(message):
    print(f"{RED}❌ {message}{RESET}")

def print_warning(message):
    print(f"{YELLOW}⚠️  {message}{RESET}")

def print_info(message):
    print(f"{BLUE}ℹ️  {message}{RESET}")

def check_environment_variables():
    """Check if all required environment variables are set"""
    print("\n" + "="*60)
    print("1️⃣  CHECKING ENVIRONMENT VARIABLES")
    print("="*60 + "\n")

    required_vars = {
        'WHATSAPP_VERIFY_TOKEN': 'Webhook verification token',
        'WHATSAPP_ACCESS_TOKEN': 'Meta API access token',
        'WHATSAPP_PHONE_NUMBER_ID': 'WhatsApp phone number ID',
        'META_APP_ID': 'Meta application ID',
        'REDIS_URL': 'Redis connection URL'
    }

    all_set = True

    for var, description in required_vars.items():
        value = os.getenv(var)
        if value:
            # Mask sensitive values
            if 'TOKEN' in var or 'SECRET' in var:
                masked = value[:8] + '...' + value[-4:] if len(value) > 12 else '***'
                print_success(f"{var}: {masked}")
            else:
                print_success(f"{var}: {value}")
        else:
            print_error(f"{var} is NOT SET ({description})")
            all_set = False

    return all_set

def check_webhook_endpoint():
    """Check if webhook endpoints are accessible"""
    print("\n" + "="*60)
    print("2️⃣  CHECKING WEBHOOK ENDPOINTS")
    print("="*60 + "\n")

    base_url = "https://bill-e-backend-lfwp.onrender.com"

    # Check health endpoint
    try:
        print_info("Testing /health endpoint...")
        response = requests.get(f"{base_url}/health", timeout=10)
        if response.status_code == 200:
            print_success(f"Health check passed: {response.json()}")
        else:
            print_error(f"Health check failed: {response.status_code}")
            return False
    except Exception as e:
        print_error(f"Cannot reach backend: {e}")
        return False

    # Check webhook verification
    verify_token = os.getenv('WHATSAPP_VERIFY_TOKEN')
    if verify_token:
        try:
            print_info("Testing webhook verification...")
            params = {
                'hub.mode': 'subscribe',
                'hub.challenge': 'TEST_CHALLENGE_12345',
                'hub.verify_token': verify_token
            }
            response = requests.get(f"{base_url}/webhook/whatsapp", params=params, timeout=10)

            if response.status_code == 200 and response.text == 'TEST_CHALLENGE_12345':
                print_success("Webhook verification endpoint working correctly")
                return True
            else:
                print_error(f"Webhook verification failed: {response.status_code} - {response.text}")
                return False
        except Exception as e:
            print_error(f"Webhook test failed: {e}")
            return False
    else:
        print_warning("Cannot test webhook - WHATSAPP_VERIFY_TOKEN not set")
        return False

def check_meta_api_access():
    """Check if Meta API access token is valid"""
    print("\n" + "="*60)
    print("3️⃣  CHECKING META API ACCESS")
    print("="*60 + "\n")

    access_token = os.getenv('WHATSAPP_ACCESS_TOKEN')
    phone_number_id = os.getenv('WHATSAPP_PHONE_NUMBER_ID')

    if not access_token or not phone_number_id:
        print_error("Access token or phone number ID not set")
        return False

    try:
        print_info("Testing Meta Graph API access...")
        url = f"https://graph.facebook.com/v18.0/{phone_number_id}"
        headers = {"Authorization": f"Bearer {access_token}"}

        response = requests.get(url, headers=headers, timeout=10)

        if response.status_code == 200:
            data = response.json()
            print_success(f"Meta API access working")
            print_info(f"  Phone Number: {data.get('display_phone_number', 'N/A')}")
            print_info(f"  Verified Name: {data.get('verified_name', 'N/A')}")
            print_info(f"  Quality Rating: {data.get('quality_rating', 'N/A')}")
            return True
        else:
            print_error(f"Meta API error: {response.status_code}")
            print_error(f"Response: {response.text}")
            return False

    except Exception as e:
        print_error(f"Meta API test failed: {e}")
        return False

def check_redis_connection():
    """Check Redis connection"""
    print("\n" + "="*60)
    print("4️⃣  CHECKING REDIS CONNECTION")
    print("="*60 + "\n")

    try:
        import redis
        redis_url = os.getenv('REDIS_URL')

        if not redis_url:
            print_error("REDIS_URL not set")
            return False

        print_info("Testing Redis connection...")
        client = redis.from_url(redis_url, decode_responses=True, ssl_cert_reqs=None)

        # Test ping
        if client.ping():
            print_success("Redis connection successful")

            # Test set/get
            test_key = "whatsapp_setup_test"
            client.set(test_key, "test_value", ex=10)
            value = client.get(test_key)

            if value == "test_value":
                print_success("Redis read/write test passed")
                client.delete(test_key)
                return True
            else:
                print_error("Redis read/write test failed")
                return False
        else:
            print_error("Redis ping failed")
            return False

    except ImportError:
        print_error("redis package not installed (pip install redis)")
        return False
    except Exception as e:
        print_error(f"Redis test failed: {e}")
        return False

def print_summary(checks_passed):
    """Print summary and next steps"""
    print("\n" + "="*60)
    print("📊 SUMMARY")
    print("="*60 + "\n")

    total = len(checks_passed)
    passed = sum(checks_passed.values())

    print(f"Total Checks: {total}")
    print(f"Passed: {GREEN}{passed}{RESET}")
    print(f"Failed: {RED}{total - passed}{RESET}")
    print()

    if all(checks_passed.values()):
        print_success("ALL CHECKS PASSED! ✨")
        print()
        print_info("You're ready to configure WhatsApp in Meta Developer Console!")
        print_info("Next steps:")
        print("  1. Go to: https://developers.facebook.com/apps/1157116873291877")
        print("  2. Navigate to WhatsApp > Configuration")
        print("  3. Configure webhook with:")
        print(f"     URL: https://bill-e-backend-lfwp.onrender.com/webhook/whatsapp")
        print(f"     Token: {os.getenv('WHATSAPP_VERIFY_TOKEN', 'NOT_SET')}")
        print()
        print_info("For complete guide, see: WHATSAPP_COMMERCIAL_SETUP.md")
    else:
        print_error("SOME CHECKS FAILED")
        print()
        print_warning("Fix the issues above before proceeding to Meta configuration")
        print()

        if not checks_passed['environment']:
            print("  → Set missing environment variables in Render")
        if not checks_passed['webhook']:
            print("  → Check backend logs and deployment")
        if not checks_passed['meta_api']:
            print("  → Verify access token in Meta Developer Console")
        if not checks_passed['redis']:
            print("  → Check Redis connection URL")

    return all(checks_passed.values())

def main():
    print(f"\n{BLUE}{'='*60}")
    print("🤖 WhatsApp Business API - Configuration Verification")
    print(f"{'='*60}{RESET}\n")

    checks_passed = {
        'environment': check_environment_variables(),
        'webhook': check_webhook_endpoint(),
        'meta_api': check_meta_api_access(),
        'redis': check_redis_connection()
    }

    all_passed = print_summary(checks_passed)

    sys.exit(0 if all_passed else 1)

if __name__ == "__main__":
    main()
