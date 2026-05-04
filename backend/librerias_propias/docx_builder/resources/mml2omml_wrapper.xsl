<?xml version="1.0" encoding="utf-8"?>
<xsl:stylesheet
    version="1.0"
    xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
  <xsl:import href="mml2omml.xsl"/>
  <xsl:output method="xml" encoding="UTF-8" indent="no"/>

  <xsl:template match="/">
    <m:oMath>
      <xsl:apply-templates select="*" mode="mml"/>
    </m:oMath>
  </xsl:template>
</xsl:stylesheet>
