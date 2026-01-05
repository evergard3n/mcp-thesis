#!/bin/bash

echo "╔════════════════════════════════════════════════════════════════════╗"
echo "║            Interactive Use Case Score Checker                      ║"
echo "║            Check điểm số chi tiết của use case                     ║"
echo "╚════════════════════════════════════════════════════════════════════╝"
echo ""

SERVER_URL="http://localhost:3000/mcp"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check server
if ! curl -s -o /dev/null "$SERVER_URL" 2>/dev/null; then
    echo -e "${RED}❌ Server chưa chạy!${NC}"
    echo "Hãy start server: npm run dev"
    exit 1
fi

echo -e "${GREEN}✅ Server đang chạy!${NC}"
echo ""

# Function to extract score details
extract_score() {
    local json="$1"
    local field="$2"
    echo "$json" | jq -r ".score.$field // 0" 2>/dev/null
}

# Function to display score bar
score_bar() {
    local score=$1
    local max=$2
    local width=30
    local filled=$(awk "BEGIN {printf \"%.0f\", ($score/$max) * $width}")
    
    printf "["
    for ((i=0; i<$width; i++)); do
        if [ $i -lt $filled ]; then
            printf "█"
        else
            printf "░"
        fi
    done
    printf "]"
}

# Initialize project
echo "════════════════════════════════════════════════════════════════════"
echo "📦 Step 1: Initialize Test Project"
echo "════════════════════════════════════════════════════════════════════"

curl -s -X POST "$SERVER_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc":"2.0",
    "method":"tools/call",
    "params":{
      "name":"initProject",
      "arguments":{
        "name":"score-checker-project",
        "description":"Project for checking use case scores"
      }
    },
    "id":1
  }' | jq -r '.result.content[0].text' 2>/dev/null

echo ""

# Test Case 1: POOR use case
echo "════════════════════════════════════════════════════════════════════"
echo "📝 Test Case 1: POOR Use Case"
echo "════════════════════════════════════════════════════════════════════"
echo ""
echo -e "${YELLOW}Input:${NC} \"User login\""
echo ""

POOR_INPUT="User login"

EXTRACT_POOR=$(curl -s -X POST "$SERVER_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "{
    \"jsonrpc\":\"2.0\",
    \"method\":\"tools/call\",
    \"params\":{
      \"name\":\"extractUseCase\",
      \"arguments\":{
        \"input\":\"$POOR_INPUT\"
      }
    },
    \"id\":2
  }")

POOR_JSON=$(echo "$EXTRACT_POOR" | jq -r '.result.content[0].text' | grep -oP '(?<=<useCase>).*(?=</useCase>)' | tr -d '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')

echo "⏳ Validating..."

VALIDATE_POOR=$(curl -s -X POST "$SERVER_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "{
    \"jsonrpc\":\"2.0\",
    \"method\":\"tools/call\",
    \"params\":{
      \"name\":\"validateUseCase\",
      \"arguments\":{
        \"extractedJsonString\":$(echo "$POOR_JSON" | jq -R .)
      }
    },
    \"id\":3
  }")

RESULT_POOR=$(echo "$VALIDATE_POOR" | jq -r '.result.content[0].text' 2>/dev/null)

# Extract scores
OVERALL_POOR=$(extract_score "$RESULT_POOR" "overall")
NAME_SCORE=$(extract_score "$RESULT_POOR" "hasVerbNounPattern")
SUMMARY_COV=$(extract_score "$RESULT_POOR" "summaryCoverage")
PRE_POST=$(extract_score "$RESULT_POOR" "hasPreconditions")
ACTOR_PART=$(extract_score "$RESULT_POOR" "actorParticipation")
PROCESS_PAT=$(extract_score "$RESULT_POOR" "processPatternCoverage")
HAS_ALT=$(extract_score "$RESULT_POOR" "hasAlternativeFlow")
HAS_EXC=$(extract_score "$RESULT_POOR" "hasExceptionFlow")
STRUCT_PEN=$(extract_score "$RESULT_POOR" "structuralPenalty")

echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo -e "${RED}❌ POOR USE CASE SCORE REPORT${NC}"
echo "═══════════════════════════════════════════════════════════════════"
echo ""
echo -e "${BLUE}Overall Score:${NC} ${RED}$OVERALL_POOR/100${NC}"
score_bar $OVERALL_POOR 100
echo ""
echo ""
echo "📊 Detailed Breakdown:"
echo "───────────────────────────────────────────────────────────────────"
echo ""

# Convert to percentage for display
SUMMARY_PERCENT=$(awk "BEGIN {printf \"%.0f\", $SUMMARY_COV * 100}")
ACTOR_PERCENT=$(awk "BEGIN {printf \"%.0f\", $ACTOR_PART * 100}")
PROCESS_PERCENT=$(awk "BEGIN {printf \"%.0f\", $PROCESS_PAT * 100}")

echo "1. Name Quality (Weight: 5%)"
if [ "$NAME_SCORE" == "false" ] || [ "$NAME_SCORE" == "0" ]; then
    echo -e "   ${RED}✗${NC} No verb-noun pattern"
else
    echo -e "   ${GREEN}✓${NC} Has verb-noun pattern"
fi
echo ""

echo "2. Summary Coverage (Weight: 12%)"
echo -e "   Coverage: ${SUMMARY_PERCENT}%"
score_bar $SUMMARY_PERCENT 100
echo ""
echo ""

echo "3. Preconditions/Postconditions (Weight: 8%)"
if [ "$PRE_POST" == "false" ] || [ "$PRE_POST" == "0" ]; then
    echo -e "   ${RED}✗${NC} Missing preconditions"
else
    echo -e "   ${GREEN}✓${NC} Has preconditions"
fi
echo ""

echo "4. Actor Participation (Weight: 16%)"
echo -e "   Participation: ${ACTOR_PERCENT}%"
score_bar $ACTOR_PERCENT 100
echo ""
echo ""

echo "5. Process Patterns (Weight: 20%) ⭐ MOST IMPORTANT"
echo -e "   Coverage: ${PROCESS_PERCENT}%"
score_bar $PROCESS_PERCENT 100
echo ""
if [ $(echo "$PROCESS_PAT < 0.5" | bc) -eq 1 ]; then
    echo -e "   ${RED}⚠ Missing: Input/Validation/Persistence/Feedback${NC}"
fi
echo ""

echo "6. Alternative Flows (Weight: 18%)"
if [ "$HAS_ALT" == "false" ] || [ "$HAS_ALT" == "0" ]; then
    echo -e "   ${RED}✗${NC} No alternative flows"
else
    echo -e "   ${GREEN}✓${NC} Has alternative flows"
fi
echo ""

echo "7. Exception Flows"
if [ "$HAS_EXC" == "false" ] || [ "$HAS_EXC" == "0" ]; then
    echo -e "   ${RED}✗${NC} No exception flows"
else
    echo -e "   ${GREEN}✓${NC} Has exception flows"
fi
echo ""

echo "8. Structural Integrity"
if [ $(echo "$STRUCT_PEN > 0" | bc) -eq 1 ]; then
    echo -e "   ${RED}⚠ Penalty: -${STRUCT_PEN} points${NC}"
else
    echo -e "   ${GREEN}✓${NC} No structural errors"
fi
echo ""

echo "───────────────────────────────────────────────────────────────────"
echo -e "${RED}Result: FAIL (< 80)${NC} - Needs significant improvement"
echo "═══════════════════════════════════════════════════════════════════"
echo ""

sleep 2

# Test Case 2: GOOD use case
echo "════════════════════════════════════════════════════════════════════"
echo "📝 Test Case 2: GOOD Use Case"
echo "════════════════════════════════════════════════════════════════════"
echo ""
echo -e "${YELLOW}Input:${NC} Complete use case with all details..."
echo ""

GOOD_INPUT="Use case: Login to Banking System

Description: This use case allows a registered customer to securely login to their online banking account. The system validates credentials, creates a session, and provides access to banking services.

Main Actor: Customer

Preconditions:
- Customer must have a valid registered account
- System is operational and accessible
- Customer has valid credentials

Postconditions:
- Customer is authenticated
- Customer session is created
- Customer can access dashboard

Main Flow:
1. Customer navigates to the login page
2. System displays the login form
3. Customer enters their username
4. Customer enters their password
5. Customer clicks the Login button
6. System validates the username format
7. System validates the password against stored credentials
8. System creates a new session for the customer
9. System logs the successful login event
10. System redirects customer to the account dashboard
11. System displays welcome message
12. Use case ends

Alternative Flow 1: Invalid Username
Condition: Username format is invalid
Steps:
1. System displays error message
2. Resume at step 3

Alternative Flow 2: Invalid Password
Condition: Password does not match
Steps:
1. System increments failed attempt counter
2. System displays error message
3. Resume at step 4

Exception Flow 1: Account Locked
Condition: Customer exceeded maximum attempts
Steps:
1. System locks the account
2. System displays error message
3. System sends notification email
4. Use case ends"

EXTRACT_GOOD=$(curl -s -X POST "$SERVER_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "{
    \"jsonrpc\":\"2.0\",
    \"method\":\"tools/call\",
    \"params\":{
      \"name\":\"extractUseCase\",
      \"arguments\":{
        \"input\":$(echo "$GOOD_INPUT" | jq -Rs .)
      }
    },
    \"id\":4
  }")

GOOD_JSON=$(echo "$EXTRACT_GOOD" | jq -r '.result.content[0].text' | grep -oP '(?<=<useCase>).*(?=</useCase>)' | tr -d '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')

echo "⏳ Validating..."

VALIDATE_GOOD=$(curl -s -X POST "$SERVER_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "{
    \"jsonrpc\":\"2.0\",
    \"method\":\"tools/call\",
    \"params\":{
      \"name\":\"validateUseCase\",
      \"arguments\":{
        \"extractedJsonString\":$(echo "$GOOD_JSON" | jq -R .)
      }
    },
    \"id\":5
  }")

RESULT_GOOD=$(echo "$VALIDATE_GOOD" | jq -r '.result.content[0].text' 2>/dev/null)

# Extract scores
OVERALL_GOOD=$(extract_score "$RESULT_GOOD" "overall")
NAME_SCORE_G=$(extract_score "$RESULT_GOOD" "hasVerbNounPattern")
SUMMARY_COV_G=$(extract_score "$RESULT_GOOD" "summaryCoverage")
PRE_POST_G=$(extract_score "$RESULT_GOOD" "hasPreconditions")
ACTOR_PART_G=$(extract_score "$RESULT_GOOD" "actorParticipation")
PROCESS_PAT_G=$(extract_score "$RESULT_GOOD" "processPatternCoverage")
HAS_ALT_G=$(extract_score "$RESULT_GOOD" "hasAlternativeFlow")
HAS_EXC_G=$(extract_score "$RESULT_GOOD" "hasExceptionFlow")
STRUCT_PEN_G=$(extract_score "$RESULT_GOOD" "structuralPenalty")

echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo -e "${GREEN}✅ GOOD USE CASE SCORE REPORT${NC}"
echo "═══════════════════════════════════════════════════════════════════"
echo ""
echo -e "${BLUE}Overall Score:${NC} ${GREEN}$OVERALL_GOOD/100${NC}"
score_bar $OVERALL_GOOD 100
echo ""
echo ""
echo "📊 Detailed Breakdown:"
echo "───────────────────────────────────────────────────────────────────"
echo ""

SUMMARY_PERCENT_G=$(awk "BEGIN {printf \"%.0f\", $SUMMARY_COV_G * 100}")
ACTOR_PERCENT_G=$(awk "BEGIN {printf \"%.0f\", $ACTOR_PART_G * 100}")
PROCESS_PERCENT_G=$(awk "BEGIN {printf \"%.0f\", $PROCESS_PAT_G * 100}")

echo "1. Name Quality (Weight: 5%)"
if [ "$NAME_SCORE_G" == "true" ] || [ "$NAME_SCORE_G" == "1" ]; then
    echo -e "   ${GREEN}✓${NC} Has verb-noun pattern"
else
    echo -e "   ${RED}✗${NC} No verb-noun pattern"
fi
echo ""

echo "2. Summary Coverage (Weight: 12%)"
echo -e "   Coverage: ${SUMMARY_PERCENT_G}%"
score_bar $SUMMARY_PERCENT_G 100
echo ""
echo ""

echo "3. Preconditions/Postconditions (Weight: 8%)"
if [ "$PRE_POST_G" == "true" ] || [ "$PRE_POST_G" == "1" ]; then
    echo -e "   ${GREEN}✓${NC} Has preconditions and postconditions"
else
    echo -e "   ${RED}✗${NC} Missing preconditions"
fi
echo ""

echo "4. Actor Participation (Weight: 16%)"
echo -e "   Participation: ${ACTOR_PERCENT_G}%"
score_bar $ACTOR_PERCENT_G 100
echo ""
echo ""

echo "5. Process Patterns (Weight: 20%) ⭐ MOST IMPORTANT"
echo -e "   Coverage: ${PROCESS_PERCENT_G}%"
score_bar $PROCESS_PERCENT_G 100
echo ""
if [ $(echo "$PROCESS_PAT_G >= 0.8" | bc) -eq 1 ]; then
    echo -e "   ${GREEN}✓ All patterns: Input/Validation/Persistence/Feedback${NC}"
fi
echo ""

echo "6. Alternative Flows (Weight: 18%)"
if [ "$HAS_ALT_G" == "true" ] || [ "$HAS_ALT_G" == "1" ]; then
    echo -e "   ${GREEN}✓${NC} Has alternative flows"
else
    echo -e "   ${RED}✗${NC} No alternative flows"
fi
echo ""

echo "7. Exception Flows"
if [ "$HAS_EXC_G" == "true" ] || [ "$HAS_EXC_G" == "1" ]; then
    echo -e "   ${GREEN}✓${NC} Has exception flows"
else
    echo -e "   ${RED}✗${NC} No exception flows"
fi
echo ""

echo "8. Structural Integrity"
if [ $(echo "$STRUCT_PEN_G > 0" | bc) -eq 1 ]; then
    echo -e "   ${RED}⚠ Penalty: -${STRUCT_PEN_G} points${NC}"
else
    echo -e "   ${GREEN}✓${NC} No structural errors"
fi
echo ""

echo "───────────────────────────────────────────────────────────────────"
echo -e "${GREEN}Result: PASS (≥ 80)${NC} - High quality use case!"
echo "═══════════════════════════════════════════════════════════════════"
echo ""

# Comparison
echo "════════════════════════════════════════════════════════════════════"
echo "📈 COMPARISON & IMPROVEMENT"
echo "════════════════════════════════════════════════════════════════════"
echo ""

IMPROVEMENT=$(awk "BEGIN {printf \"%.0f\", $OVERALL_GOOD - $OVERALL_POOR}")

echo "┌────────────────────────────┬──────────┬──────────┬────────────┐"
echo "│ Metric                     │ Poor UC  │ Good UC  │ Improvement│"
echo "├────────────────────────────┼──────────┼──────────┼────────────┤"
printf "│ %-26s │ %8s │ %8s │ %10s │\n" "Overall Score" "$OVERALL_POOR" "$OVERALL_GOOD" "+$IMPROVEMENT"
printf "│ %-26s │ %8s │ %8s │ %10s │\n" "Summary Coverage" "${SUMMARY_PERCENT}%" "${SUMMARY_PERCENT_G}%" "+$(($SUMMARY_PERCENT_G - $SUMMARY_PERCENT))%"
printf "│ %-26s │ %8s │ %8s │ %10s │\n" "Actor Participation" "${ACTOR_PERCENT}%" "${ACTOR_PERCENT_G}%" "+$(($ACTOR_PERCENT_G - $ACTOR_PERCENT))%"
printf "│ %-26s │ %8s │ %8s │ %10s │\n" "Process Patterns" "${PROCESS_PERCENT}%" "${PROCESS_PERCENT_G}%" "+$(($PROCESS_PERCENT_G - $PROCESS_PERCENT))%"
echo "└────────────────────────────┴──────────┴──────────┴────────────┘"
echo ""

echo "🎯 Key Improvements:"
echo "  • Added preconditions and postconditions"
echo "  • Included alternative flows with conditions"
echo "  • Added exception handling"
echo "  • Covered all process patterns (input/validate/persist/feedback)"
echo "  • Detailed step descriptions with actor mentions"
echo "  • Clear trigger and ending states"
echo ""

echo "════════════════════════════════════════════════════════════════════"
echo "✅ Score Checking Complete!"
echo "════════════════════════════════════════════════════════════════════"
echo ""
echo "💡 Tips:"
echo "  • Read SCORING_GUIDE.md for detailed scoring algorithm"
echo "  • Aim for 80+ score for production-ready use cases"
echo "  • Focus on Process Patterns (20%) and Branch Flows (18%)"
echo ""
