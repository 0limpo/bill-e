"""
WhatsApp Analytics Dashboard API Routes
Complete customer journey insights and business metrics

Endpoints provide:
- Conversion funnel (photo → link → completion)
- User retention & engagement
- Viral coefficient tracking
- Cost per acquisition/completion
- Error analytics
- Response time distribution
"""

from fastapi import APIRouter, Query, HTTPException
from typing import Optional
from datetime import datetime

from whatsapp_analytics import whatsapp_analytics

router = APIRouter(prefix="/api/whatsapp", tags=["whatsapp-analytics"])


@router.get("/dashboard")
async def get_whatsapp_dashboard(days: int = Query(7, ge=1, le=90)):
    """
    Complete WhatsApp analytics dashboard

    Returns comprehensive metrics for WhatsApp customer journey
    """
    try:
        dashboard = {
            'timestamp': datetime.utcnow().isoformat(),
            'period_days': days,

            # Core conversion funnel
            'conversion_funnel': whatsapp_analytics.get_conversion_funnel(days),

            # User retention
            'retention': whatsapp_analytics.get_retention_metrics(days),

            # Viral growth
            'viral_metrics': whatsapp_analytics.get_viral_coefficient(days),

            # Performance
            'response_times': whatsapp_analytics.get_response_time_stats(days),

            # Business metrics
            'cost_analysis': whatsapp_analytics.get_cost_per_completion(days),

            # Quality metrics
            'error_analytics': whatsapp_analytics.get_error_analytics(days),

            # Summary KPIs
            'summary': _calculate_summary_kpis(days)
        }

        return dashboard

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get dashboard: {str(e)}")


@router.get("/funnel")
async def get_conversion_funnel(days: int = Query(7, ge=1, le=90)):
    """
    Get detailed conversion funnel metrics

    Shows drop-off at each stage:
    1. Photo received
    2. OCR success → Link sent
    3. Link clicked
    4. Bill completed
    """
    try:
        funnel = whatsapp_analytics.get_conversion_funnel(days)

        # Add insights
        funnel['insights'] = _generate_funnel_insights(funnel)

        return funnel

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get funnel: {str(e)}")


@router.get("/retention")
async def get_retention_metrics(days: int = Query(30, ge=1, le=90)):
    """
    Get user retention metrics

    Tracks:
    - New vs returning users
    - Retention rate
    - Daily active users
    """
    try:
        retention = whatsapp_analytics.get_retention_metrics(days)

        # Add cohort analysis insights
        retention['insights'] = _generate_retention_insights(retention)

        return retention

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get retention: {str(e)}")


@router.get("/viral")
async def get_viral_metrics(days: int = Query(7, ge=1, le=90)):
    """
    Get viral growth metrics

    Calculates:
    - K-factor (viral coefficient)
    - Shares per user
    - Viral loop effectiveness
    """
    try:
        viral = whatsapp_analytics.get_viral_coefficient(days)

        # Add growth predictions
        viral['predictions'] = _predict_viral_growth(viral)

        return viral

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get viral metrics: {str(e)}")


@router.get("/performance")
async def get_performance_metrics(days: int = Query(7, ge=1, le=90)):
    """
    Get performance metrics

    Includes:
    - OCR response time distribution
    - Message delivery times
    - System performance
    """
    try:
        performance = whatsapp_analytics.get_response_time_stats(days)

        # Add performance grade
        performance['grade'] = _calculate_performance_grade(performance)

        return performance

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get performance: {str(e)}")


@router.get("/costs")
async def get_cost_metrics(days: int = Query(7, ge=1, le=90)):
    """
    Get cost analysis

    Calculates:
    - Cost per completion
    - OCR costs
    - WhatsApp messaging costs
    - ROI metrics
    """
    try:
        costs = whatsapp_analytics.get_cost_per_completion(days)

        # Add pricing recommendations
        costs['pricing_recommendations'] = _generate_pricing_recommendations(costs)

        return costs

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get costs: {str(e)}")


@router.get("/errors")
async def get_error_analytics(days: int = Query(7, ge=1, le=90)):
    """
    Get error analytics

    Shows:
    - Error types and frequency
    - Error trends
    - Most common failures
    """
    try:
        errors = whatsapp_analytics.get_error_analytics(days)

        # Add recommendations
        errors['recommendations'] = _generate_error_recommendations(errors)

        return errors

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get errors: {str(e)}")


@router.get("/journey/{phone_number}")
async def get_user_journey(phone_number: str):
    """
    Get detailed journey for a specific user

    Shows complete flow from photo to completion
    """
    try:
        journey = whatsapp_analytics._get_active_journey(phone_number)

        if not journey:
            raise HTTPException(status_code=404, detail="No active journey found")

        # Calculate timing metrics
        journey_dict = journey.to_dict()
        journey_dict['timing_analysis'] = _analyze_journey_timing(journey)

        return journey_dict

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get journey: {str(e)}")


@router.get("/insights")
async def get_business_insights(days: int = Query(7, ge=1, le=90)):
    """
    Get actionable business insights

    AI-powered recommendations based on metrics
    """
    try:
        # Get all metrics
        funnel = whatsapp_analytics.get_conversion_funnel(days)
        retention = whatsapp_analytics.get_retention_metrics(days)
        viral = whatsapp_analytics.get_viral_coefficient(days)
        costs = whatsapp_analytics.get_cost_per_completion(days)
        errors = whatsapp_analytics.get_error_analytics(days)

        insights = {
            'timestamp': datetime.utcnow().isoformat(),
            'period_days': days,

            # Key findings
            'key_findings': _generate_key_findings(funnel, retention, viral, costs, errors),

            # Opportunities
            'opportunities': _identify_opportunities(funnel, retention, viral),

            # Warnings
            'warnings': _identify_warnings(funnel, errors),

            # Action items
            'action_items': _generate_action_items(funnel, retention, viral, costs, errors)
        }

        return insights

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate insights: {str(e)}")


# ================ HELPER FUNCTIONS ================

def _calculate_summary_kpis(days: int) -> dict:
    """Calculate summary KPIs for dashboard"""
    funnel = whatsapp_analytics.get_conversion_funnel(days)
    retention = whatsapp_analytics.get_retention_metrics(days)
    viral = whatsapp_analytics.get_viral_coefficient(days)
    costs = whatsapp_analytics.get_cost_per_completion(days)

    return {
        'overall_conversion_rate': funnel['conversion_rates'].get('overall', 0),
        'total_users': retention.get('total_users', 0),
        'retention_rate': retention.get('retention_rate', 0),
        'k_factor': viral.get('k_factor', 0),
        'cost_per_completion': costs.get('cost_per_completion_usd', 0),
        'health_score': _calculate_health_score(funnel, retention, viral)
    }


def _calculate_health_score(funnel: dict, retention: dict, viral: dict) -> int:
    """Calculate overall system health score (0-100)"""
    score = 0

    # Conversion rate (40 points max)
    conversion = funnel['conversion_rates'].get('overall', 0)
    score += min(40, conversion * 2)

    # Retention (30 points max)
    retention_rate = retention.get('retention_rate', 0)
    score += min(30, retention_rate * 0.6)

    # Viral coefficient (30 points max)
    k_factor = viral.get('k_factor', 0)
    score += min(30, k_factor * 30)

    return int(score)


def _generate_funnel_insights(funnel: dict) -> list:
    """Generate insights from funnel data"""
    insights = []

    conversion_rates = funnel.get('conversion_rates', {})

    # Photo to link conversion
    photo_to_link = conversion_rates.get('photo_to_link', 0)
    if photo_to_link < 70:
        insights.append({
            'type': 'warning',
            'metric': 'OCR Success Rate',
            'value': f"{photo_to_link:.1f}%",
            'message': f"OCR success rate is low ({photo_to_link:.1f}%). Consider improving image quality guidance or OCR algorithm."
        })
    elif photo_to_link > 90:
        insights.append({
            'type': 'success',
            'metric': 'OCR Success Rate',
            'value': f"{photo_to_link:.1f}%",
            'message': "Excellent OCR success rate! Users are sending clear photos."
        })

    # Link to click conversion
    link_to_click = conversion_rates.get('link_to_click', 0)
    if link_to_click < 60:
        insights.append({
            'type': 'opportunity',
            'metric': 'Link Click Rate',
            'value': f"{link_to_click:.1f}%",
            'message': f"Only {link_to_click:.1f}% of users click the link. Consider improving link message or adding urgency."
        })

    # Overall conversion
    overall = conversion_rates.get('overall', 0)
    if overall < 20:
        insights.append({
            'type': 'critical',
            'metric': 'Overall Conversion',
            'value': f"{overall:.1f}%",
            'message': "Overall conversion is very low. Review entire user experience."
        })

    return insights


def _generate_retention_insights(retention: dict) -> list:
    """Generate insights from retention data"""
    insights = []

    retention_rate = retention.get('retention_rate', 0)
    new_users = retention.get('new_users', 0)
    returning_users = retention.get('returning_users', 0)

    if retention_rate > 40:
        insights.append({
            'type': 'success',
            'message': f"Strong retention! {retention_rate:.1f}% of users return to use the service again."
        })
    elif retention_rate < 20:
        insights.append({
            'type': 'warning',
            'message': f"Low retention rate ({retention_rate:.1f}%). Users rarely return after first use."
        })

    if new_users > returning_users * 3:
        insights.append({
            'type': 'info',
            'message': "Growth is primarily from new users. Focus on retention to build a loyal user base."
        })

    return insights


def _predict_viral_growth(viral: dict) -> dict:
    """Predict viral growth based on K-factor"""
    k_factor = viral.get('k_factor', 0)
    total_users = viral.get('total_users', 0)

    if k_factor <= 0:
        return {
            'status': 'No viral growth',
            'projected_users_30_days': total_users
        }

    # Simple viral growth projection
    # Growth = users * (1 + k_factor) ^ cycles
    cycles_per_month = 4  # Assume 4 viral cycles per month
    projected_growth = total_users * ((1 + k_factor) ** cycles_per_month)

    return {
        'status': 'Viral' if k_factor > 1 else 'Sub-viral',
        'k_factor': k_factor,
        'projected_users_30_days': int(projected_growth),
        'growth_multiplier': projected_growth / total_users if total_users > 0 else 1
    }


def _calculate_performance_grade(performance: dict) -> str:
    """Calculate performance grade based on response times"""
    avg_ms = performance.get('avg_ms', 0)

    if avg_ms == 0:
        return 'N/A'
    elif avg_ms < 2000:
        return 'A+ (Excellent)'
    elif avg_ms < 3000:
        return 'A (Very Good)'
    elif avg_ms < 5000:
        return 'B (Good)'
    elif avg_ms < 8000:
        return 'C (Acceptable)'
    else:
        return 'D (Needs Improvement)'


def _generate_pricing_recommendations(costs: dict) -> list:
    """Generate pricing recommendations based on costs"""
    cost_per_completion = costs.get('cost_per_completion_usd', 0)

    recommendations = []

    if cost_per_completion == 0:
        return [{'message': 'Not enough data to generate pricing recommendations'}]

    # Calculate suggested pricing tiers
    margins = [
        {'margin': 50, 'multiplier': 2},
        {'margin': 70, 'multiplier': 3.33},
        {'margin': 90, 'multiplier': 10}
    ]

    for margin_data in margins:
        price = cost_per_completion * margin_data['multiplier']
        recommendations.append({
            'margin': f"{margin_data['margin']}%",
            'suggested_price_per_use': f"${price:.2f}",
            'monthly_subscription': f"${price * 4:.2f}",
            'message': f"With {margin_data['margin']}% margin, charge ${price:.2f} per split or ${price * 4:.2f}/month for 4 splits"
        })

    return recommendations


def _generate_error_recommendations(errors: dict) -> list:
    """Generate recommendations based on error analytics"""
    recommendations = []

    error_types = errors.get('error_types', [])
    total_errors = errors.get('total_errors', 0)

    if total_errors == 0:
        return [{'message': 'No errors detected - system running smoothly!'}]

    # Get top error
    if error_types:
        top_error = error_types[0]

        # Common error fixes
        error_fixes = {
            'No text detected': 'Add image quality validation before OCR. Guide users to take clearer photos.',
            'Text extraction failed': 'Improve OCR preprocessing (contrast, rotation, noise reduction).',
            'Invalid image format': 'Add file type validation and conversion.',
            'Image too large': 'Implement automatic image compression before processing.',
            'OCR timeout': 'Optimize OCR processing or increase timeout limits.'
        }

        for error_pattern, fix in error_fixes.items():
            if error_pattern.lower() in top_error['error'].lower():
                recommendations.append({
                    'error': top_error['error'],
                    'frequency': f"{top_error['percentage']:.1f}%",
                    'recommendation': fix
                })
                break

        # If no specific match, add generic recommendation
        if not recommendations:
            recommendations.append({
                'error': top_error['error'],
                'frequency': f"{top_error['percentage']:.1f}%",
                'recommendation': f"This error accounts for {top_error['percentage']:.1f}% of failures. Investigate root cause and implement fix."
            })

    return recommendations


def _analyze_journey_timing(journey) -> dict:
    """Analyze timing of user journey"""
    timing = {}

    if journey.photo_timestamp and journey.link_timestamp:
        from datetime import datetime
        photo_time = datetime.fromisoformat(journey.photo_timestamp)
        link_time = datetime.fromisoformat(journey.link_timestamp)
        timing['photo_to_link_seconds'] = (link_time - photo_time).total_seconds()
        timing['photo_to_link_status'] = 'Fast' if timing['photo_to_link_seconds'] < 5 else 'Slow'

    if journey.link_timestamp and journey.link_click_timestamp:
        link_time = datetime.fromisoformat(journey.link_timestamp)
        click_time = datetime.fromisoformat(journey.link_click_timestamp)
        timing['link_to_click_seconds'] = (click_time - link_time).total_seconds()
        timing['link_to_click_status'] = 'Fast' if timing['link_to_click_seconds'] < 60 else 'Slow'

    if journey.link_click_timestamp and journey.completion_timestamp:
        click_time = datetime.fromisoformat(journey.link_click_timestamp)
        completion_time = datetime.fromisoformat(journey.completion_timestamp)
        timing['click_to_completion_seconds'] = (completion_time - click_time).total_seconds()
        timing['click_to_completion_status'] = 'Fast' if timing['click_to_completion_seconds'] < 120 else 'Slow'

    return timing


def _generate_key_findings(funnel, retention, viral, costs, errors):
    """Generate key business findings"""
    findings = []

    # Conversion findings
    overall_conversion = funnel['conversion_rates'].get('overall', 0)
    findings.append(f"Overall conversion rate: {overall_conversion:.1f}% of users complete their bill split")

    # Retention findings
    retention_rate = retention.get('retention_rate', 0)
    findings.append(f"User retention: {retention_rate:.1f}% of users return to use the service")

    # Viral findings
    k_factor = viral.get('k_factor', 0)
    if k_factor > 1:
        findings.append(f"🚀 Viral growth! K-factor of {k_factor:.2f} means exponential user growth")
    else:
        findings.append(f"Sub-viral growth: K-factor of {k_factor:.2f} - need {(1-k_factor):.2f} more to achieve viral growth")

    # Cost findings
    cost_per_completion = costs.get('cost_per_completion_usd', 0)
    findings.append(f"Cost per successful split: ${cost_per_completion:.3f}")

    return findings


def _identify_opportunities(funnel, retention, viral):
    """Identify growth opportunities"""
    opportunities = []

    # Funnel opportunities
    link_to_click = funnel['conversion_rates'].get('link_to_click', 0)
    if link_to_click < 70:
        opportunities.append({
            'area': 'Link Click Rate',
            'current': f"{link_to_click:.1f}%",
            'opportunity': 'Improve link message and add urgency to increase clicks',
            'potential_impact': 'High'
        })

    # Retention opportunities
    retention_rate = retention.get('retention_rate', 0)
    if retention_rate < 30:
        opportunities.append({
            'area': 'User Retention',
            'current': f"{retention_rate:.1f}%",
            'opportunity': 'Implement email/WhatsApp follow-up to bring users back',
            'potential_impact': 'Medium'
        })

    # Viral opportunities
    k_factor = viral.get('k_factor', 0)
    if k_factor < 0.5:
        opportunities.append({
            'area': 'Viral Growth',
            'current': f"K-factor: {k_factor:.2f}",
            'opportunity': 'Add referral incentives to increase sharing',
            'potential_impact': 'High'
        })

    return opportunities


def _identify_warnings(funnel, errors):
    """Identify warning signs"""
    warnings = []

    # OCR warnings
    ocr_success = funnel['conversion_rates'].get('photo_to_link', 0)
    if ocr_success < 60:
        warnings.append({
            'severity': 'High',
            'metric': 'OCR Success Rate',
            'value': f"{ocr_success:.1f}%",
            'issue': 'More than 40% of photos fail OCR processing',
            'action': 'Review error analytics and improve OCR or user guidance'
        })

    # Error warnings
    total_errors = errors.get('total_errors', 0)
    if total_errors > 100:
        warnings.append({
            'severity': 'Medium',
            'metric': 'Total Errors',
            'value': total_errors,
            'issue': f"{total_errors} errors in the period",
            'action': 'Review error types and implement fixes for top errors'
        })

    return warnings


def _generate_action_items(funnel, retention, viral, costs, errors):
    """Generate actionable items based on data"""
    actions = []

    # Priority 1: Fix critical issues
    ocr_success = funnel['conversion_rates'].get('photo_to_link', 0)
    if ocr_success < 70:
        actions.append({
            'priority': 'P1 - Critical',
            'action': 'Improve OCR success rate',
            'why': f"Currently only {ocr_success:.1f}% of photos process successfully",
            'how': 'Add image quality validation, improve OCR preprocessing, update user guidance'
        })

    # Priority 2: Optimize conversion
    link_to_click = funnel['conversion_rates'].get('link_to_click', 0)
    if link_to_click < 70:
        actions.append({
            'priority': 'P2 - High',
            'action': 'Increase link click rate',
            'why': f"Only {link_to_click:.1f}% of users click the link after receiving it",
            'how': 'A/B test different message formats, add urgency, send follow-up reminder'
        })

    # Priority 3: Growth initiatives
    k_factor = viral.get('k_factor', 0)
    if k_factor < 1:
        actions.append({
            'priority': 'P3 - Medium',
            'action': 'Implement viral loop',
            'why': f"K-factor of {k_factor:.2f} means no viral growth",
            'how': 'Add "Share with friends" CTA, offer incentives for referrals, make sharing easier'
        })

    return actions


# Export router
__all__ = ['router']
